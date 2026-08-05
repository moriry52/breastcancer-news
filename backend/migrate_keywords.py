#!/usr/bin/env python3
"""
キーワードフィールド付与マイグレーションスクリプト
(Backfill 'keywords' field on existing Firestore articles)

用途:
  Firestoreの articles コレクション内で `keywords` フィールドが存在しない
  既存ドキュメントに対し、保存済みテキストフィールドからキーワードトークンを
  生成して update() する。

使い方:
  # 更新対象の確認のみ（書き込みなし）
  python migrate_keywords.py --dry-run

  # 実際に書き込みを実行
  python migrate_keywords.py

オプション:
  --dry-run     Firestoreへの書き込みを行わずに対象件数だけ表示
  --force       keywords が既存でも再生成して上書き（デフォルトは既存フィールドがある場合スキップ）
"""

import os
import sys
import re
import json
import argparse
import logging
from dotenv import load_dotenv

# Setup Logging
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

load_dotenv()


def generate_keywords(texts: list) -> list:
    """
    検索用キーワードトークン配列を生成する。
    - 英数字: 小文字化・記号除去・スペース分割で単語単位トークン
    - 日本語(CJK): 2文字バイグラムで展開 + 1文字もインデックス登録
    - 重複除去・空文字除去。最大200トークンに丸める。
    """
    tokens = set()

    for text in texts:
        if not text:
            continue
        text_lower = text.lower()

        # 英数字トークン
        en_tokens = re.split(r"[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+", text_lower)
        for tok in en_tokens:
            tok = tok.strip()
            if len(tok) >= 2:
                tokens.add(tok)

        # CJK バイグラム + 1文字
        cjk_chars = re.findall(r"[\u3040-\u30ff\u4e00-\u9fff]", text)
        for i in range(len(cjk_chars) - 1):
            tokens.add(cjk_chars[i] + cjk_chars[i + 1])
        for ch in cjk_chars:
            tokens.add(ch)

    result = sorted(t for t in tokens if t)
    return result[:200]


def init_firestore():
    """Firebase Admin SDK の初期化"""
    import firebase_admin
    from firebase_admin import credentials, firestore

    if firebase_admin._apps:
        return firestore.client()

    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
    service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")

    resolved_cred_path = None
    if cred_path:
        if os.path.exists(cred_path):
            resolved_cred_path = cred_path
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            alt_path = os.path.join(base_dir, cred_path)
            if os.path.exists(alt_path):
                resolved_cred_path = alt_path

    if resolved_cred_path:
        cred = credentials.Certificate(resolved_cred_path)
        firebase_admin.initialize_app(cred)
        logger.info(f"Firebaseを初期化しました (ファイル: {resolved_cred_path})")
    elif service_account_json:
        cred_dict = json.loads(service_account_json)
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        logger.info("Firebaseを初期化しました (環境変数JSONより)")
    else:
        logger.error("Firebase認証情報が設定されていません。.env を確認してください。")
        return None

    return firestore.client()


def run_migration(dry_run: bool, force: bool):
    """articles コレクション全件に対して keywords フィールドを付与する"""

    db = init_firestore()
    if not db:
        logger.error("Firestore接続に失敗しました。処理を中止します。")
        sys.exit(1)

    logger.info("articles コレクションを全件取得中...")
    docs = list(db.collection("articles").stream())
    total = len(docs)
    logger.info(f"取得完了: {total} 件")

    count_updated = 0
    count_skipped = 0
    count_error = 0

    for doc in docs:
        data = doc.to_dict()
        pmid = data.get("pmid", doc.id)

        # force=False のとき、keywords が既に存在 (空でない) ならスキップ
        existing_keywords = data.get("keywords")
        if not force and existing_keywords:
            logger.debug(f"[Skip] PMID {pmid}: keywords フィールドが既に存在します ({len(existing_keywords)} トークン)")
            count_skipped += 1
            continue

        # summary_3lines は list[str] で保存されている
        summary_text = " ".join(data.get("summary_3lines") or [])

        keywords = generate_keywords([
            data.get("title", ""),
            data.get("title_ja", ""),
            data.get("journal", ""),
            summary_text,
            data.get("score_reason", ""),
        ])

        logger.info(
            f"[{'DRY-RUN' if dry_run else 'UPDATE'}] PMID {pmid}: "
            f"{len(keywords)} トークン生成 "
            f"(例: {keywords[:5]}{'...' if len(keywords) > 5 else ''})"
        )

        if not dry_run:
            try:
                db.collection("articles").document(doc.id).update({"keywords": keywords})
                count_updated += 1
            except Exception as e:
                logger.error(f"[Error] PMID {pmid}: 更新失敗 → {e}")
                count_error += 1
        else:
            count_updated += 1  # dry-run では対象数としてカウント

    # 結果サマリ
    logger.info("=" * 50)
    if dry_run:
        logger.info(f"[DRY-RUN 完了] 更新予定: {count_updated} 件 / スキップ: {count_skipped} 件 / 合計: {total} 件")
        logger.info("実際に書き込むには --dry-run を外して再実行してください。")
    else:
        logger.info(f"[完了] 更新: {count_updated} 件 / スキップ: {count_skipped} 件 / エラー: {count_error} 件 / 合計: {total} 件")
    logger.info("=" * 50)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Firestore articles コレクションに keywords フィールドを付与するマイグレーションスクリプト"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="書き込みを行わず、対象件数と生成トークンのみ表示する"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="keywords フィールドが既に存在するドキュメントも強制的に上書きする"
    )
    args = parser.parse_args()

    if args.dry_run:
        logger.info("=== DRY-RUN モードで実行中（書き込みなし）===")
    else:
        logger.info("=== 本番モードで実行中（Firestoreに書き込みます）===")

    run_migration(dry_run=args.dry_run, force=args.force)
