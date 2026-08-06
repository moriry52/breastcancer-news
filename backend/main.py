#!/usr/bin/env python3
"""
乳癌論文自動収集 & ニュース・抄読会スライド自動生成バッチスクリプト
(Breast Cancer Research News & Journal Club Slide Generator)

特徴:
- PubMed API (Bio.Entrez) から直近7日間の「breast cancer」関連論文を収集。
- Firestoreの既存データと照合し、収集済みの論文 (PMID) は事前重複除外。
- アブストラクトの有無・文献タイプ (Case Reports/Editorial除外)・主要誌/研究デザインの1次フィルタ。
- Gemini API (google-genai) の超長コンテキストを活用した「全論文一括スコアリング (1 API Call Batch Processing)」:
  - 臨床影響度 (0-40点)
  - 新規性・話題性 (0-30点)
  - 抄読会適合度 (0-30点)
  - 70点以上の高評価論文のみ日本語3行要約および5枚構成の抄読会スライドデータを生成。
- Firestoreの `articles` コレクションへ保存。
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

# Biopython
from Bio import Entrez

# Pydantic for Gemini Batch Structured Output
from pydantic import BaseModel, Field

# Setup Logging & Encoding for Windows Console compatibility
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Load Environment Variables safely
try:
    load_dotenv()
except Exception:
    pass

# Set Entrez Email (Required by NCBI)
ENTREZ_EMAIL = os.environ.get("NCBI_EMAIL", "your-email@example.com")
Entrez.email = ENTREZ_EMAIL

# Major Target Journals & Publication Types for Primary Filtering
MAJOR_JOURNALS = [
    "n engl j med", "new england journal of medicine",
    "lancet", "lancet oncol", "lancet oncology",
    "jama", "jama oncol", "jama oncology",
    "j clin oncol", "journal of clinical oncology",
    "ann oncol", "annals of oncology",
    "clin cancer res", "clinical cancer research",
    "breast cancer res treat", "breast cancer research and treatment",
    "breast", "nature medicine", "nat med", "cancer discov", "cancer discovery"
]

EXCLUDED_PUB_TYPES = [
    "case reports", "editorial", "letter", "comment", "biography",
    "published erratum", "retraction of publication", "historical article"
]

PRIORITY_PUB_TYPES = [
    "randomized controlled trial", "clinical trial, phase iii",
    "meta-analysis", "systematic review", "clinical trial, phase ii"
]


# Pydantic Schemas for Gemini Batch Structured Output
class SlideContent(BaseModel):
    slide_number: int = Field(description="スライド番号 (1-5)")
    slide_type: str = Field(description="スライドタイプ: 'Background', 'Methods', 'Results', 'Conclusion', 'Clinical Takeaway' のいずれか")
    title: str = Field(description="スライドのタイトル（日本語）")
    bullets: List[str] = Field(description="スライドの内容（日本語の箇条書き3〜4行）")

class EvaluatedArticle(BaseModel):
    pmid: str = Field(description="対象論文のPMID")
    title_ja: str = Field(description="論文タイトルの自然な日本語訳")
    score: int = Field(description="合計スコア (0〜100点満点)。臨床影響度(0-40)+新規性話題性(0-30)+抄読会適合度(0-30)")
    score_reason: str = Field(description="スコア選定理由 (50文字程度の日本語)")
    category: str = Field(description="カテゴリ: '薬物療法', '手術・局所療法', '診断・ゲノム・画像', 'その他' のいずれか")
    summary_3lines: List[str] = Field(description="論文の日本語3行要約（要素数3の文字列リスト）")
    slides: List[SlideContent] = Field(description="合格論文(70点以上)の抄読会用5枚スライド。70点未満の場合は空リストでも可")

class BatchEvaluationResponse(BaseModel):
    evaluations: List[EvaluatedArticle] = Field(description="全入力論文に対する評価結果リスト")


def get_existing_pmids_from_firestore(db_client) -> set:
    """Firestoreから保存済みのPMID一覧を取得する"""
    if not db_client:
        return set()
    try:
        articles_ref = db_client.collection("articles")
        docs = articles_ref.select(["pmid"]).stream()
        existing_pmids = {doc.to_dict().get("pmid") for doc in docs if doc.to_dict().get("pmid")}
        logger.info(f"Firestoreから既存の {len(existing_pmids)} 件のPMIDを取得しました。")
        return existing_pmids
    except Exception as e:
        logger.warning(f"FirestoreからのPMID取得に失敗しました (初回または権限不足の可能性): {e}")
        return set()


def fetch_recent_pubmed_articles(end_date_str: Optional[str] = None, days: int = 7, max_results: int = 50) -> List[Dict[str, Any]]:
    """PubMed APIから指定日（または今日）から過去 `days` 日間の乳癌関連論文を収集する"""
    if end_date_str:
        try:
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d")
        except ValueError:
            logger.error(f"日付フォーマットエラー: '{end_date_str}' は YYYY-MM-DD 形式で指定してください。デフォルト(今日)を使用します。")
            end_date = datetime.now()
    else:
        end_date = datetime.now()

    start_date = end_date - timedelta(days=days)
    
    date_str = f"{start_date.strftime('%Y/%m/%d')}:{end_date.strftime('%Y/%m/%d')}[PDAT]"
    term = f'("breast neoplasms"[MeSH Terms] OR "breast cancer"[Title/Abstract]) AND {date_str}'
    
    logger.info(f"PubMed検索開始: 期間 {start_date.strftime('%Y/%m/%d')} 〜 {end_date.strftime('%Y/%m/%d')} (過去{days}日間)")
    
    try:
        handle = Entrez.esearch(db="pubmed", term=term, retmax=max_results, sort="pub_date")
        search_results = Entrez.read(handle)
        handle.close()
        
        id_list = search_results.get("IdList", [])
        logger.info(f"PubMed検索ヒット数: {len(id_list)} 件のPMIDを検出")
        
        if not id_list:
            return []
            
        # Detail Fetch
        handle = Entrez.efetch(db="pubmed", id=",".join(id_list), retmode="xml")
        records = Entrez.read(handle)
        handle.close()
        
        articles = []
        pubmed_articles = records.get("PubmedArticle", [])
        
        for record in pubmed_articles:
            try:
                medline = record["MedlineCitation"]
                pmid = str(medline["PMID"])
                article_data = medline["Article"]
                
                # Title
                title = article_data.get("ArticleTitle", "").strip()
                
                # Abstract
                abstract_list = article_data.get("Abstract", {}).get("AbstractText", [])
                abstract = " ".join([str(a) for a in abstract_list]).strip() if abstract_list else ""
                
                # Journal
                journal_title = article_data.get("Journal", {}).get("Title", "").strip()
                
                # Publication Types
                pub_types = [str(pt) for pt in article_data.get("PublicationTypeList", [])]
                
                # Publication Date
                pub_date_dict = article_data.get("Journal", {}).get("JournalIssue", {}).get("PubDate", {})
                year = pub_date_dict.get("Year", str(end_date.year))
                month = pub_date_dict.get("Month", "01")
                day = pub_date_dict.get("Day", "01")
                pub_date = f"{year}-{month}-{day}"
                
                # Authors
                author_list = article_data.get("AuthorList", [])
                authors = []
                for a in author_list[:5]: # top 5
                    last = a.get("LastName", "")
                    fore = a.get("ForeName", "")
                    if last:
                        authors.append(f"{last} {fore}".strip())
                
                # DOI
                doi = ""
                for el in article_data.get("ELocationID", []):
                    if el.attributes.get("EIdType") == "doi":
                        doi = str(el)
                        break

                articles.append({
                    "pmid": pmid,
                    "title": title,
                    "abstract": abstract,
                    "journal": journal_title,
                    "pub_types": pub_types,
                    "pub_date": pub_date,
                    "authors": authors,
                    "doi": doi
                })
            except Exception as ex:
                logger.warning(f"論文データのパース中にスキップが発生しました: {ex}")
                continue

        return articles

    except Exception as e:
        logger.error(f"PubMed APIからのデータ取得中にエラーが発生しました: {e}")
        return []


def primary_filter(article: Dict[str, Any], existing_pmids: set) -> bool:
    """1次フィルタリング（重複除外、Abstract有無、PubTypes、Journalチェック）"""
    pmid = article["pmid"]
    
    # 1. 重複チェック
    if pmid in existing_pmids:
        logger.debug(f"[Skip] PMID {pmid}: すでにFirestoreに存在します。")
        return False
        
    # 2. Abstractの有無
    if not article["abstract"] or len(article["abstract"]) < 100:
        logger.debug(f"[Skip] PMID {pmid}: アブストラクトが存在しないか短すぎます。")
        return False
        
    # 3. 除外すべき文献タイプ
    pub_types_lower = [pt.lower() for pt in article["pub_types"]]
    for ex_type in EXCLUDED_PUB_TYPES:
        if any(ex_type in pt for pt in pub_types_lower):
            logger.debug(f"[Skip] PMID {pmid}: 除外対象文献タイプ '{ex_type}' です。")
            return False
            
    # 4. 主要ジャーナルまたは優先研究デザインの優遇判定
    journal_lower = article["journal"].lower()
    is_major_journal = any(mj in journal_lower for mj in MAJOR_JOURNALS)
    is_priority_design = any(any(p_type in pt for pt in pub_types_lower) for p_type in PRIORITY_PUB_TYPES)

    if is_major_journal or is_priority_design or len(article["abstract"]) > 300:
        return True
        
    return True


def evaluate_all_articles_in_batch(articles: List[Dict[str, Any]], api_key: str) -> List[EvaluatedArticle]:
    """Gemini APIの超長コンテキストを活用し、全論文を一括で1回のリクエストで評価・スライド生成する"""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    # 全論文のテキストを1つの巨大プロンプトへ結合
    articles_formatted_text = ""
    for idx, art in enumerate(articles, start=1):
        articles_formatted_text += f"""
---
[論文 #{idx}]
PMID: {art['pmid']}
Title: {art['title']}
Journal: {art['journal']}
Abstract: {art['abstract']}
"""

    prompt = f"""
あなたは日本の乳腺外科トップ専門医であり、医局の抄読会幹事です。
以下に提示する全 {len(articles)} 件の乳癌関連論文を一括で精読・比較評価し、各論文について日本の乳腺外科医にとっての「読む価値・面白さ」を厳密にスコアリング（100点満点）してください。

【評価基準 (合計100点満点)】
1. 臨床影響度 (0-40点): 明日からの乳がん診療・標準治療・処方選択肢を変えるインパクトがあるか。
2. 新規性・話題性 (0-30点): Artificial Intelligence(AI), ADC, CDK4/6i, 免疫療法, PARP, ctDNA, De-escalationなどトレンドか。
3. 抄読会適合度 (0-30点): 医局のカンファレンスや抄読会でディスカッションを呼ぶ興味深いテーマか。

【全 {len(articles)} 件の論文リスト】
{articles_formatted_text}

【出力要件】
- evaluations リスト内に全論文のPMIDに対応する評価オブジェクトを格納してください。
- title_ja: 論文タイトルの自然な日本語訳を作成してください。
- 70点以上の高評価論文については、必ず日本語3行要約(summary_3lines)と抄読会用5枚スライド(slides: Background, Methods, Results, Conclusion, Clinical Takeaway)を作成してください。
"""

    logger.info(f"Gemini APIへ全 {len(articles)} 件の論文を一括送信中 (1 API Call Batch Processing)...")

    try:
        response = client.models.generate_content(
            model='gemini-3.1-flash-lite',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=BatchEvaluationResponse,
                temperature=0.2
            ),
        )

        if response.text:
            result_dict = json.loads(response.text)
            batch_res = BatchEvaluationResponse(**result_dict)
            return batch_res.evaluations
        return []

    except Exception as e:
        logger.error(f"Gemini API 一括評価中にエラーが発生しました: {e}")
        return []


def init_firestore():
    """Firebase Admin SDKの初期化"""
    import firebase_admin
    from firebase_admin import credentials, firestore

    if firebase_admin._apps:
        return firestore.client()

    cred = credentials.Certificate('backend/serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
    logger.info(f"Firebaseを初期化しました")

    return firestore.client()


def generate_keywords(texts: list[str]) -> list[str]:
    """検索用キーワードトークン配列を生成する。
    - 英数字: 小文字化・記号除去・スペース分割で単語単位トークン
    - 日本語(CJK): 2文字バイグラムで展開（形態素解析不要の簡易方式）
    - 重複除去・空文字除去。最大200トークンに丸める。
    """
    import re
    tokens = set()

    for text in texts:
        if not text:
            continue
        text_lower = text.lower()

        # 英数字トークン (記号・ハイフン等を空白扱いに変換してsplit)
        en_tokens = re.split(r"[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+", text_lower)
        for tok in en_tokens:
            tok = tok.strip()
            if len(tok) >= 2:
                tokens.add(tok)

        # CJK 文字（漢字・ひらがな・カタカナ）に対して2文字バイグラムを生成
        cjk_chars = re.findall(r"[\u3040-\u30ff\u4e00-\u9fff]", text)
        for i in range(len(cjk_chars) - 1):
            bigram = cjk_chars[i] + cjk_chars[i + 1]
            tokens.add(bigram)
        # 1文字のCJKも単体でインデックス登録（短いキーワード対応）
        for ch in cjk_chars:
            tokens.add(ch)

    # 空文字除去 → ソートして最大200件に丸める
    result = sorted(t for t in tokens if t)
    return result[:200]


def save_to_firestore(db_client, article: Dict[str, Any], eval_res: EvaluatedArticle, target_date: Optional[datetime] = None):
    """合格した論文データをFirestore `articles` コレクションへ書き込む"""
    if not db_client:
        logger.warning(f"[Firestore Skip] PMID {article['pmid']}: DBクライアント未設定のため保存をスキップ。")
        return

    # published_at: ニュース配信指定日（未指定時は今日）
    pub_at_dt = target_date if target_date else datetime.now()

    # 検索用キーワードトークン生成（title・title_ja・journal・summary・score_reason）
    summary_text = " ".join(eval_res.summary_3lines or [])
    keywords = generate_keywords([
        article.get("title", ""),
        getattr(eval_res, "title_ja", ""),
        article.get("journal", ""),
        summary_text,
        eval_res.score_reason or "",
    ])

    doc_data = {
        "pmid": article["pmid"],
        "title": article["title"],
        "title_ja": getattr(eval_res, "title_ja", article["title"]),
        "journal": article["journal"],
        "pub_date": article["pub_date"],
        "authors": article["authors"],
        "doi": article["doi"],
        "abstract": article["abstract"],
        
        # AI Scored & Generated Fields
        "score": eval_res.score,
        "score_reason": eval_res.score_reason,
        "category": eval_res.category,
        "summary_3lines": eval_res.summary_3lines,
        "slides": [slide.model_dump() for slide in eval_res.slides],

        # Search Keywords (for Firestore array-contains queries)
        "keywords": keywords,

        "published_at": pub_at_dt.isoformat(),
        "created_at": datetime.now()  # DB作成日時は常に物理実行日時
    }


    try:
        # doc IDに pmid を使用して重複書き込みを防ぐ
        db_client.collection("articles").document(article["pmid"]).set(doc_data)
        logger.info(f"Firestore保存成功 [PMID {article['pmid']}] スコア: {eval_res.score}点 ({eval_res.category})")
    except Exception as e:
        logger.error(f"Firestoreへの保存中にエラーが発生しました [PMID {article['pmid']}]: {e}")


def main():
    parser = argparse.ArgumentParser(description="Breast Cancer News Batch Processor")
    parser.add_argument("--date", "--end-date", type=str, default=None, help="検索終了日 (YYYY-MM-DD形式。例: 2026-07-15。未指定時は今日)")
    parser.add_argument("--days", type=int, default=7, help="検索対象の遡り日数 (デフォルト: 7日間)")
    parser.add_argument("--limit", type=int, default=30, help="PubMedからの最大取得件数 (デフォルト: 30件)")
    parser.add_argument("--dry-run", action="store_true", help="Firestoreへの保存を行わずローカル出力のみテスト")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("エラー: GEMINI_API_KEY 環境変数が設定されていません。.env ファイルを確認してください。")
        if not args.dry_run:
            sys.exit(1)

    db_client = None if args.dry_run else init_firestore()
    existing_pmids = get_existing_pmids_from_firestore(db_client)

    # 1. PubMed収集
    articles = fetch_recent_pubmed_articles(end_date_str=args.date, days=args.days, max_results=args.limit)
    logger.info(f"取得完了: {len(articles)} 件の論文データを取得")

    # 2. 1次フィルタリング & 重複排除
    filtered_articles = [art for art in articles if primary_filter(art, existing_pmids)]
    logger.info(f"1次フィルタ通過: {len(filtered_articles)} / {len(articles)} 件")

    if not filtered_articles:
        logger.info("対象となる新規論文はありませんでした。")
        return

    # 3. Gemini 2次評価 (全論文一括処理: 1 API Call)
    logger.info(f"=== Gemini AI 一括評価処理を開始します (全 {len(filtered_articles)} 件 / 1 API Call) ===")

    passed_count = 0
    saved_articles = []

    if not api_key:
        logger.warning("GEMINI_API_KEY 未設定のためモック評価データを作成します。")
        evaluations = [
            EvaluatedArticle(
                pmid=art["pmid"],
                score=85 if idx == 1 else 60,
                score_reason="CDK4/6阻害薬の新規エビデンスであり臨床インパクトが大きい。",
                category="薬物療法",
                summary_3lines=[
                    "HR陽性HER2陰性早期乳癌における新規併用療法の第III相試験結果。",
                    "無病生存期間(DFS)の有意な延長が証明された。",
                    "副作用プロファイルも許容範囲であり、今後の標準治療の選択肢となる。"
                ],
                slides=[
                    SlideContent(slide_number=1, slide_type="Background", title="背景と目的", bullets=["HR+ HER2- 乳癌における術後療法の最適化"]),
                    SlideContent(slide_number=2, slide_type="Methods", title="研究デザイン", bullets=["第III相比較試験"]),
                    SlideContent(slide_number=3, slide_type="Results", title="結果", bullets=["DFS有意延長"]),
                    SlideContent(slide_number=4, slide_type="Conclusion", title="結論", bullets=["再発リスク減少"]),
                    SlideContent(slide_number=5, slide_type="Clinical Takeaway", title="臨床提示", bullets=["新処方選択肢"])
                ]
            )
            for idx, art in enumerate(filtered_articles, start=1)
        ]
    else:
        evaluations = evaluate_all_articles_in_batch(filtered_articles, api_key)

    # 評価結果をPMIDキーでマップ
    eval_map = {e.pmid: e for e in evaluations}

    target_date_obj = None
    if args.date:
        try:
            target_date_obj = datetime.strptime(args.date, "%Y-%m-%d")
        except ValueError:
            target_date_obj = None

    for art in filtered_articles:
        pmid = art["pmid"]
        eval_res = eval_map.get(pmid)

        if not eval_res:
            logger.warning(f"PMID {pmid} の評価結果がGeminiレスポンスに見つかりませんでした。")
            continue

        status_str = "合格 (70点以上)" if eval_res.score >= 70 else "不合格"
        logger.info(f"[OK] 判定完了 PMID {pmid}: スコア={eval_res.score}点 ({status_str}) - {eval_res.score_reason}")

        if eval_res.score >= 70:
            passed_count += 1
            save_to_firestore(db_client, art, eval_res, target_date=target_date_obj)
            saved_articles.append({
                "article": art,
                "evaluation": eval_res.model_dump()
            })

    logger.info(f"=== 一括処理完了: 70点以上の高評価合格論文: {passed_count} 件 / 全 {len(filtered_articles)} 件 ===")

    if args.dry_run and saved_articles:
        print("\n--- [DRY-RUN OUTPUT SAMPLING] ---")
        print(json.dumps(saved_articles[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
