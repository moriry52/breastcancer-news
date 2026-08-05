/**
 * Breast Cancer Paper News & Journal Club Generator
 * Frontend Logic (Vanilla JS + Firebase JS SDK Compat v10)
 */

// 1. Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDvXRqXpIv3WGsBdgG3o_TMuORdpbAaY3o",
    authDomain: "breastcancer-news.firebaseapp.com",
    projectId: "breastcancer-news",
    storageBucket: "breastcancer-news.firebasestorage.app",
    messagingSenderId: "792349818078",
    appId: "1:792349818078:web:fa5d6500de0fe85dd2164f"
};

// Application State
let articlesData = [];
let filteredArticles = [];
let favoritePmids = new Set();
let currentArticleForModal = null;
let currentSlideIndex = 0;
let db = null;

// Pagination State
let currentPage = 1;
const itemsPerPage = 12;

// Demo / Fallback Mock Articles (Used when Firebase is unconfigured or offline)
const MOCK_ARTICLES = [
    {
        pmid: "38912345",
        title_ja: "HER2陽性転移性乳癌におけるT-DXd vs T-DM1の直接比較：DESTINY-Breast03の最新全生存期間解析",
        title: "Trastuzumab Deruxtecan vs Trastuzumab Emtansine in Patients with HER2-Positive Metastatic Breast Cancer: Updated Survival Analysis of DESTINY-Breast03",
        journal: "N Engl J Med",
        pub_date: "2026-08-01",
        authors: ["Cortés J", "Kim SB", "Chung WP", "Im SA", "Park YH"],
        score: 96,
        score_reason: "HER2陽性転移性乳癌における標準治療を塗り替える全生存期間(OS)の大幅な延長効果が実証された。",
        category: "薬物療法",
        summary_3lines: [
            "HER2陽性転移性乳癌を対象にT-DXdとT-DM1の有効性を直接比較した国際第III相試験の更新解析。",
            "T-DXd群はT-DM1群と比較して無増悪生存期間(PFS)および全生存期間(OS)で統計学的に高度に有意な延長を示した。",
            "間質性肺疾患(ILD)の発生頻度は制御可能な範囲であり、HER2陽性二次治療の標準治療としての地位を固めた。"
        ],
        slides: [
            { slide_number: 1, slide_type: "Background", title: "背景と目的", bullets: ["HER2陽性転移性乳癌における二次治療選択肢の確立。"] },
            { slide_number: 2, slide_type: "Methods", title: "研究デザイン", bullets: ["ランダム化第III相比較試験 n=524"] },
            { slide_number: 3, slide_type: "Results", title: "結果", bullets: ["OS・PFSともにT-DXd群が著明に優れる"] },
            { slide_number: 4, slide_type: "Conclusion", title: "結論", bullets: ["二次治療の第一選択薬としての地位を確立"] },
            { slide_number: 5, slide_type: "Clinical Takeaway", title: "臨床示唆", bullets: ["明日からの標準処方選択肢となる"] }
        ]
    },
    {
        pmid: "38923456",
        title_ja: "HR陽性HER2陰性リンパ節陽性高リスク早期乳癌におけるアベマシクリブ併用療法：monarchE試験の5年有効性結果",
        title: "Abemaciclib Plus Endocrine Therapy in HR-Positive, HER2-Negative, Node-Positive High-Risk Early Breast Cancer: 5-Year Efficacy Results From monarchE",
        journal: "J Clin Oncol",
        pub_date: "2026-07-28",
        authors: ["Harbeck N", "Rastogi P", "Martin M", "Tolaney SM", "Johnston SRD"],
        score: 91,
        score_reason: "5年長期フォローアップによりアベマシクリブ術後併用療法のキャリーオーバー効果と再発抑制が裏付けられた。",
        category: "薬物療法",
        summary_3lines: [
            "HR+/HER2-の高リスク早期乳癌におけるアベマシクリブ(CDK4/6i)+内分泌療法2年投与の5年追跡結果。",
            "2年間のアベマシクリブ投与終了後も、無浸潤疾患生残期間(IDFS)の差が拡大し続ける「キャリーオーバー効果」を確認。",
            "遠隔再発リスクを32.5%低下させ、高リスク乳がんにおける術後標準療法の堅牢性を示した。"
        ],
        slides: [
            { slide_number: 1, slide_type: "Background", title: "背景と目的", bullets: ["高リスク早期乳癌の遠隔再発抑制"] },
            { slide_number: 2, slide_type: "Methods", title: "研究デザイン", bullets: ["アベマシクリブ2年投与の5年追跡"] },
            { slide_number: 3, slide_type: "Results", title: "結果", bullets: ["5年IDFS率: 83.6% vs 76.0% (HR 0.68)"] },
            { slide_number: 4, slide_type: "Conclusion", title: "結論", bullets: ["長期的な遠隔再発予防効果を発揮"] },
            { slide_number: 5, slide_type: "Clinical Takeaway", title: "臨床示唆", bullets: ["高リスク群に対する必須術後療法"] }
        ]
    }
];

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
    loadFavoritesFromStorage();
    initFirebaseApp();
    setupEventListeners();
});

// Load / Save Favorites from LocalStorage
function loadFavoritesFromStorage() {
    try {
        const stored = localStorage.getItem("breast_cancer_news_favorites");
        if (stored) {
            favoritePmids = new Set(JSON.parse(stored));
        }
    } catch (e) {
        console.error("LocalStorage読み込みエラー:", e);
    }
    updateFavoriteCount();
}

function saveFavoritesToStorage() {
    try {
        localStorage.setItem("breast_cancer_news_favorites", JSON.stringify(Array.from(favoritePmids)));
    } catch (e) {
        console.error("LocalStorage保存エラー:", e);
    }
    updateFavoriteCount();
}

function toggleFavorite(pmid) {
    if (favoritePmids.has(pmid)) {
        favoritePmids.delete(pmid);
    } else {
        favoritePmids.add(pmid);
    }
    saveFavoritesToStorage();
    applyFiltersAndRender(false); // ページ位置を維持（リセットしない）
}

/**
 * お気に入りのPMIDのうち articlesData にまだないものを
 * Firestoreからピンポイント取得して articlesData に追加する。
 * where("pmid", "in", [...]) を使用（Firestoreの in された制限: 30件/クエリ）。
 */
async function fetchMissingFavorites() {
    if (!db || favoritePmids.size === 0) return;

    const loadedPmids = new Set(articlesData.map(a => a.pmid));
    const missingPmids = Array.from(favoritePmids).filter(pmid => !loadedPmids.has(pmid));

    if (missingPmids.length === 0) return; // 全て取得済み

    updateSystemStatus(`♥ お気に入りを読み込み中... (${missingPmids.length}件)`, false);

    // Firestoreの "in" は30件までなのでバッチ処理
    const BATCH_SIZE = 30;
    const batches = [];
    for (let i = 0; i < missingPmids.length; i += BATCH_SIZE) {
        batches.push(missingPmids.slice(i, i + BATCH_SIZE));
    }

    let fetchedCount = 0;
    for (const batch of batches) {
        try {
            const snapshot = await db.collection("articles")
                .where("pmid", "in", batch)
                .get();
            snapshot.forEach(doc => {
                const data = doc.data();
                if (!loadedPmids.has(data.pmid)) {
                    articlesData.push(data);
                    loadedPmids.add(data.pmid);
                    fetchedCount++;
                }
            });
        } catch (err) {
            console.warn("お気に入りの取得エラー:", err);
        }
    }

    if (fetchedCount > 0) {
        console.log(`お気に入り: Firestoreから ${fetchedCount} 件追加取得しました。`);
    }
}

function updateFavoriteCount() {
    const favoriteCountEl = document.getElementById("favorite-count");
    if (favoriteCountEl) {
        favoriteCountEl.textContent = favoritePmids.size;
    }
}

// Initialize Firebase SDK with Offline Persistence
function initFirebaseApp() {
    const isFirebaseConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_FIREBASE");

    if (isFirebaseConfigured && typeof firebase !== "undefined") {
        try {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            fetchArticlesFromFirestore(); // ステータスはフェッチ完了後に更新
        } catch (e) {
            console.warn("Firebase初期化失敗。デモデータへ切替えます:", e);
            loadMockArticles();
            updateSystemStatus("デモモード (Firestore未接続)", true);
        }
    } else {
        console.log("FirebaseConfig未設定のためデモデータで起動します。");
        loadMockArticles();
        updateSystemStatus("デモモード (サンプルデータ表示中)", true);
    }
}

function updateSystemStatus(text, isDemo) {
    const statusEl = document.getElementById("system-status");
    if (statusEl) {
        statusEl.innerHTML = isDemo
            ? `<span class="pulse-dot" style="background:#f59e0b;"></span> ${text}`
            : `<span class="pulse-dot"></span> ${text}`;
    }
}

// State for Firestore incremental loading
let lastVisibleDoc = null;
let hasMoreFirestoreArticles = true;
let isFetchingMore = false;

// Fetch Articles from Firestore (Initial 12 items for page 1)
function fetchArticlesFromFirestore() {
    showLoading(true);
    hasMoreFirestoreArticles = true;
    lastVisibleDoc = null;

    db.collection("articles")
        .orderBy("published_at", "desc")
        .limit(itemsPerPage)
        .get()
        .then((querySnapshot) => {
            const fetched = [];
            querySnapshot.forEach((doc) => {
                fetched.push(doc.data());
            });

            if (querySnapshot.docs.length > 0) {
                lastVisibleDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
            }
            if (querySnapshot.docs.length < itemsPerPage) {
                hasMoreFirestoreArticles = false;
            }

            if (fetched.length > 0) {
                articlesData = fetched;
                // キャッシュ読み込み vs. ネットワーク取得を判別して表示
                const suffix = hasMoreFirestoreArticles ? "+" : "件";
                if (querySnapshot.metadata.fromCache) {
                    updateSystemStatus(`キャッシュから読み込み (${fetched.length}${suffix}) (オフライン)`, true);
                } else {
                    updateSystemStatus(`Firestore から取得完了 (${fetched.length}${suffix})`, false);
                }
            } else {
                console.log("Firestore内にデータがありません。デモデータを表示します。");
                articlesData = MOCK_ARTICLES;
                hasMoreFirestoreArticles = false;
                updateSystemStatus("データなし (デモ表示)", true);
            }
            applyFiltersAndRender();
        })
        .catch((error) => {
            console.error("Firestore取得エラー:", error);
            articlesData = MOCK_ARTICLES;
            hasMoreFirestoreArticles = false;
            updateSystemStatus("Firestore 取得失敗 (デモ表示)", true);
            applyFiltersAndRender();
        })
        .finally(() => {
            showLoading(false);
        });
}

// Fetch Next Page (12 Items) on Demand when user navigates
function fetchNextPageArticles(targetPage, callback) {
    if (!db || !lastVisibleDoc || !hasMoreFirestoreArticles || isFetchingMore) {
        if (callback) callback();
        return;
    }

    isFetchingMore = true;
    showLoading(true);

    db.collection("articles")
        .orderBy("published_at", "desc")
        .startAfter(lastVisibleDoc)
        .limit(itemsPerPage)
        .get()
        .then((querySnapshot) => {
            const fetchedMore = [];
            querySnapshot.forEach((doc) => {
                fetchedMore.push(doc.data());
            });

            if (querySnapshot.docs.length > 0) {
                lastVisibleDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
            }
            if (querySnapshot.docs.length < itemsPerPage) {
                hasMoreFirestoreArticles = false;
            }

            if (fetchedMore.length > 0) {
                const existingPmids = new Set(articlesData.map(a => a.pmid));
                fetchedMore.forEach(a => {
                    if (!existingPmids.has(a.pmid)) {
                        articlesData.push(a);
                    }
                });
                // 追加取得後の件数をステータスに反映
                const fromCache = querySnapshot.metadata.fromCache;
                const suffix = hasMoreFirestoreArticles ? "+" : "件";
                const statusText = fromCache
                    ? `キャッシュから追加読み込み (${articlesData.length}${suffix})`
                    : `Firestore から追加取得完了 (${articlesData.length}${suffix})`;
                updateSystemStatus(statusText, fromCache);
            }
        })
        .catch((err) => {
            console.error("次ページデータ取得エラー:", err);
        })
        .finally(() => {
            isFetchingMore = false;
            showLoading(false);
            if (callback) callback();
        });
}



// Load Mock Articles for Instant Demo
function loadMockArticles() {
    showLoading(true);
    setTimeout(() => {
        articlesData = MOCK_ARTICLES;
        applyFiltersAndRender();
        showLoading(false);
    }, 400);
}

function showLoading(isLoading) {
    const loadingState = document.getElementById("loading-state");
    if (loadingState) {
        loadingState.style.display = isLoading ? "block" : "none";
    }
}

// Filtering, Searching, and Sorting (ハイブリッド検索対応)
function applyFiltersAndRender(resetPage = true) {
    if (resetPage) currentPage = 1;

    const activeCategoryBtn = document.querySelector(".category-tabs .tab-btn.active");
    const categoryFilter = activeCategoryBtn ? activeCategoryBtn.dataset.category : "all";
    const searchQuery = document.getElementById("search-input").value.trim().toLowerCase();
    const sortBy = document.getElementById("sort-select").value;

    // --- ① ローカル部分一致検索（取得済みデータ・従来通り） ---
    const localResults = articlesData.filter((article) => {
        if (categoryFilter === "favorite") {
            if (!favoritePmids.has(article.pmid)) return false;
        } else if (categoryFilter !== "all" && article.category !== categoryFilter) {
            return false;
        }
        if (searchQuery) {
            const titleJaMatch = (article.title_ja || "").toLowerCase().includes(searchQuery);
            const titleMatch = (article.title || "").toLowerCase().includes(searchQuery);
            const journalMatch = (article.journal || "").toLowerCase().includes(searchQuery);
            const reasonMatch = (article.score_reason || "").toLowerCase().includes(searchQuery);
            const summaryMatch = (article.summary_3lines || []).some(s => s.toLowerCase().includes(searchQuery));
            return titleJaMatch || titleMatch || journalMatch || reasonMatch || summaryMatch;
        }
        return true;
    });

    // --- ② Firestoreキーワード検索（2文字以上・db接続時のみ）---
    if (searchQuery.length >= 2 && db) {
        // ローカル結果を即座に表示しつつ、Firestoreを並行検索
        applySort(localResults, sortBy);
        filteredArticles = [...localResults];
        renderArticleGrid(filteredArticles);
        updateStatsCounter(articlesData);
        updateSystemStatus(`🔍 Firestore 検索中... (ローカル ${localResults.length}件)`, false);

        searchFirestore(searchQuery).then((firestoreResults) => {
            // 取得済みPMIDを除外して追加分だけマージ
            const localPmids = new Set(articlesData.map(a => a.pmid));
            const added = firestoreResults.filter(a => !localPmids.has(a.pmid));

            if (added.length > 0) {
                // articlesData に追加（重複なし）
                added.forEach(a => articlesData.push(a));
            }

            // 追加分を含む全体でローカル検索を再実行してマージ結果を表示
            const mergedResults = articlesData.filter((article) => {
                if (categoryFilter === "favorite") {
                    if (!favoritePmids.has(article.pmid)) return false;
                } else if (categoryFilter !== "all" && article.category !== categoryFilter) {
                    return false;
                }
                const titleJaMatch = (article.title_ja || "").toLowerCase().includes(searchQuery);
                const titleMatch = (article.title || "").toLowerCase().includes(searchQuery);
                const journalMatch = (article.journal || "").toLowerCase().includes(searchQuery);
                const reasonMatch = (article.score_reason || "").toLowerCase().includes(searchQuery);
                const summaryMatch = (article.summary_3lines || []).some(s => s.toLowerCase().includes(searchQuery));
                return titleJaMatch || titleMatch || journalMatch || reasonMatch || summaryMatch;
            });

            applySort(mergedResults, sortBy);
            filteredArticles = mergedResults;
            renderArticleGrid(filteredArticles);
            updateStatsCounter(articlesData);

            const addedMsg = added.length > 0 ? ` + Firestoreから追加${added.length}件` : " (Firestore追加なし)";
            updateSystemStatus(`🔍 検索完了: ${mergedResults.length}件 (ローカル${localResults.length}件${addedMsg})`, false);
        }).catch(() => {
            // Firestoreエラーはローカル結果だけで継続
            updateSystemStatus(`🔍 検索: ${localResults.length}件 (Firestoreエラー・ローカルのみ)`, true);
        });
    } else {
        // 通常表示（検索なし or db未接続）
        applySort(localResults, sortBy);
        filteredArticles = localResults;
        renderArticleGrid(filteredArticles);
        updateStatsCounter(articlesData);
    }
}

// Sort helper
function applySort(arr, sortBy) {
    if (sortBy === "score_desc") {
        arr.sort((a, b) => b.score - a.score);
    } else {
        arr.sort((a, b) => new Date(b.published_at || b.pub_date) - new Date(a.published_at || a.pub_date));
    }
}

// Firestore キーワード検索（array-contains: 第1ワードで完全一致）
function searchFirestore(query) {
    if (!db) return Promise.resolve([]);
    // スペース区切りの最初のワードをFirestoreへ送信（array-contains は単一値のみ）
    const firstWord = query.split(/\s+/)[0].toLowerCase();
    return db.collection("articles")
        .where("keywords", "array-contains", firstWord)
        .get()
        .then((snapshot) => {
            const results = [];
            snapshot.forEach(doc => results.push(doc.data()));
            return results;
        });
}


// Render News Grid
function renderArticleGrid(articles) {
    const newsGrid = document.getElementById("news-grid");
    // Clear all existing cards and messages
    newsGrid.innerHTML = "";

    if (articles.length === 0) {
        const activeCategoryBtn = document.querySelector(".category-tabs .tab-btn.active");
        const isFavTab = activeCategoryBtn && activeCategoryBtn.dataset.category === "favorite";

        const noResult = document.createElement("div");
        noResult.className = "loading-spinner-wrapper no-results-state";
        noResult.style.display = "block";
        noResult.innerHTML = isFavTab
            ? `<i class="fa-regular fa-star" style="font-size:2.5rem; color:#f59e0b; margin-bottom:0.75rem;"></i><p>お気に入りに登録された論文はまだありません。<br>カード右上の「★」ボタンを押してお気に入りに追加できます。</p>`
            : `<i class="fa-solid fa-folder-open" style="font-size:2.5rem; margin-bottom:0.75rem;"></i><p>条件に一致する論文は見つかりませんでした。</p>`;
        newsGrid.appendChild(noResult);
        renderPaginationControls(0);
        return;
    }

    // Pagination Slice
    const totalItems = articles.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const pageArticles = articles.slice(startIndex, startIndex + itemsPerPage);

    pageArticles.forEach((article) => {
        const card = document.createElement("article");
        card.className = "article-card";

        // 日付フォーマットヘルパー (YYYY-MM-DD)
        const formatYmd = (dateStr) => {
            if (!dateStr) return "";
            try {
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) return dateStr;
                return d.toISOString().split("T")[0];
            } catch (e) {
                return dateStr;
            }
        };

        const publishedYmd = formatYmd(article.published_at);
        const pubDateDisplay = article.pub_date || "";

        // 最新配信日の判定 (全取得論文の中で最も新しい published_at 日付と一致するか)
        const maxPublishedYmd = articlesData.reduce((max, a) => {
            const ymd = formatYmd(a.published_at);
            return ymd > max ? ymd : max;
        }, "");

        const isLatestDelivery = publishedYmd && publishedYmd === maxPublishedYmd;

        if (isLatestDelivery) {
            card.classList.add("card-latest-news");
        }

        const isHighScore = article.score >= 90;
        const scoreBadgeClass = isHighScore ? "score-badge high-score" : "score-badge";
        const categoryTagClass = `category-tag tag-${article.category || 'その他'}`;

        const isFav = favoritePmids.has(article.pmid);
        const favBtnClass = isFav ? "btn-bookmark active" : "btn-bookmark";
        const favIconClass = isFav ? "fa-solid fa-star" : "fa-regular fa-star";

        const summaryHtml = (article.summary_3lines || [])
            .map(line => `<li>${escapeHtml(line)}</li>`)
            .join("");

        const titleJaDisplay = article.title_ja ? escapeHtml(article.title_ja) : escapeHtml(article.title);
        const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`;

        const newBadgeHtml = isLatestDelivery
            ? `<span class="badge-new-arrival" title="最新の配信ニュースです"><i class="fa-solid fa-bolt"></i> NEW (最新配信)</span>`
            : "";

        card.innerHTML = `
            <div class="card-header-bar">
                <div class="header-tag-group">
                    ${newBadgeHtml}
                    <span class="${categoryTagClass}">${escapeHtml(article.category || '論文')}</span>
                    <button class="${favBtnClass}" data-pmid="${article.pmid}" title="${isFav ? 'お気に入りから削除' : 'お気に入りに追加'}">
                        <i class="${favIconClass}"></i> ${isFav ? 'お気に入り' : 'お気に入り'}
                    </button>
                </div>
                <div class="${scoreBadgeClass}">
                    <i class="fa-solid fa-fire"></i> AIおすすめ ${article.score}点
                </div>
            </div>
            
            <div class="card-body">
                <!-- 日本語タイトル (メイン表示) -->
                <h3 class="article-title-ja">${titleJaDisplay}</h3>
                <!-- 英語原本タイトル (サブ表示) -->
                <div class="article-title-en">${escapeHtml(article.title)}</div>
                
                <div class="journal-meta">
                    <span><i class="fa-regular fa-bookmark"></i> ${escapeHtml(article.journal)}</span>
                    <span class="meta-date-item" title="ニュースアプリへの配信日"><i class="fa-regular fa-clock"></i> 掲載: ${publishedYmd || '今日'}</span>
                    <span class="meta-date-item" title="PubMed論文の出版日"><i class="fa-regular fa-calendar-days"></i> Publish: ${escapeHtml(pubDateDisplay)}</span>
                </div>
                
                <div class="score-reason-box">
                    <strong>選定理由:</strong> ${escapeHtml(article.score_reason || '')}
                </div>
                
                <div class="summary-container">
                    <div class="summary-header">
                        <i class="fa-solid fa-list-check"></i> 日本語3行要約
                    </div>
                    <ul class="summary-list">
                        ${summaryHtml}
                    </ul>
                </div>
            </div>

            <div class="card-footer">
                <div class="card-action-group">
                    <button class="btn-open-slides" data-pmid="${article.pmid}">
                        <i class="fa-solid fa-file-powerpoint"></i> スライドを見る (5枚)
                    </button>
                    <a href="${pubmedUrl}" target="_blank" rel="noopener noreferrer" class="btn-pubmed-external" title="PubMedで原著論文を閲覧">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> PubMed
                    </a>
                </div>
            </div>
        `;

        // Event listener for favorite toggle
        card.querySelector(".btn-bookmark").addEventListener("click", (e) => {
            e.stopPropagation();
            toggleFavorite(article.pmid);
        });

        // Event listener for slide modal open
        card.querySelector(".btn-open-slides").addEventListener("click", () => {
            openSlideModal(article);
        });

        newsGrid.appendChild(card);
    });

    renderPaginationControls(totalItems);
}

// Render Pagination Controls
function renderPaginationControls(localItemCount) {
    const container = document.getElementById("pagination-container");
    if (!container) return;

    if (localItemCount === 0) {
        container.innerHTML = "";
        return;
    }

    // 取得済み件数からのページ数 + 未取得があれば +1 ページを追加表示
    const knownPages = Math.ceil(localItemCount / itemsPerPage);
    const displayPages = (hasMoreFirestoreArticles && db) ? knownPages + 1 : knownPages;

    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, localItemCount);
    const totalLabel = `${localItemCount}${(hasMoreFirestoreArticles && db) ? '+' : ''}`;

    let html = `
        <div class="pagination-info">
            全 <strong>${totalLabel}</strong> 件中 <strong>${startItem}〜${endItem}</strong> 件目を表示中
        </div>
    `;

    if (displayPages > 1) {
        html += `
            <div class="pagination-buttons">
                <button class="page-btn nav-page-btn" id="btn-prev-page" ${currentPage === 1 ? 'disabled' : ''}>
                    <i class="fa-solid fa-chevron-left"></i> 前へ
                </button>
        `;

        for (let p = 1; p <= displayPages; p++) {
            // 現在ページは active + disabled にして押せなくする
            const isActive = p === currentPage;
            const cls = isActive ? "page-btn active" : "page-btn";
            const dis = isActive ? "disabled" : "";
            html += `<button class="${cls}" data-page="${p}" ${dis}>${p}</button>`;
        }

        const isLastPage = currentPage >= displayPages && !hasMoreFirestoreArticles;
        html += `
                <button class="page-btn nav-page-btn" id="btn-next-page" ${isLastPage ? 'disabled' : ''}>
                    次へ <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
        `;
    }

    container.innerHTML = html;

    // Helper: Navigate to target page and auto-fetch if data is missing
    const navigateToPage = (targetPage) => {
        const neededIndex = (targetPage - 1) * itemsPerPage;
        if (neededIndex >= filteredArticles.length && hasMoreFirestoreArticles && db) {
            fetchNextPageArticles(targetPage, () => {
                currentPage = targetPage;
                applyFiltersAndRender(false);
                window.scrollTo({ top: document.querySelector(".controls-bar").offsetTop - 80, behavior: "smooth" });
            });
        } else {
            currentPage = targetPage;
            applyFiltersAndRender(false);
            window.scrollTo({ top: document.querySelector(".controls-bar").offsetTop - 80, behavior: "smooth" });
        }
    };

    container.querySelectorAll(".page-btn[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            navigateToPage(parseInt(btn.dataset.page, 10));
        });
    });

    const prevBtn = document.getElementById("btn-prev-page");
    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (currentPage > 1) navigateToPage(currentPage - 1);
        });
    }

    const nextBtn = document.getElementById("btn-next-page");
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            navigateToPage(currentPage + 1);
        });
    }
}




function updateStatsCounter(allArticles) {
    const totalEl = document.getElementById("total-articles-count");
    const highScoreEl = document.getElementById("high-score-count");

    const formatYmd = (dateStr) => {
        if (!dateStr) return "";
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toISOString().split("T")[0];
        } catch (e) {
            return dateStr;
        }
    };

    // 全論文の中で最も新しい published_at 日付（最新の配信日＝本日/最新枠）
    const maxPublishedYmd = allArticles.reduce((max, a) => {
        const ymd = formatYmd(a.published_at);
        return ymd > max ? ymd : max;
    }, "");

    // 最新配信日に該当する論文の件数（「本日厳選論文」）
    const todayArticles = allArticles.filter(a => formatYmd(a.published_at) === maxPublishedYmd)
    const todayArticlesCount = todayArticles.length;

    if (totalEl) totalEl.textContent = todayArticlesCount;
    if (highScoreEl) {
        const highScoreCount = todayArticles.filter(a => a.score >= 85).length;
        highScoreEl.textContent = highScoreCount;
    }
}

// Slide Modal Logic
function openSlideModal(article) {
    currentArticleForModal = article;
    currentSlideIndex = 0;

    const modal = document.getElementById("slide-modal");
    renderSlideView();

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
}

function closeSlideModal() {
    const modal = document.getElementById("slide-modal");
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
}

function renderSlideView() {
    const article = currentArticleForModal;
    if (!article) return;

    const contentSlides = article.slides || [];
    // スライド0 = 表紙, スライド1〜N = コンテンツスライド
    const totalSlides = contentSlides.length + 1;

    const formatYmd = (dateStr) => {
        if (!dateStr) return "";
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toISOString().split("T")[0];
        } catch (e) { return dateStr; }
    };

    const slideBoxInner = document.getElementById("slide-box-inner");
    slideBoxInner.innerHTML = "";

    if (currentSlideIndex === 0) {
        // --- 表紙スライド ---
        const titleJa = escapeHtml(article.title_ja || article.title);
        const titleEn = escapeHtml(article.title);
        const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`;
        const publishedYmd = formatYmd(article.published_at);
        const categoryClass = `category-tag tag-${article.category || 'その他'}`;

        slideBoxInner.innerHTML = `
            <div class="slide-cover">
                <div class="slide-cover-header">
                    <span class="${categoryClass}">${escapeHtml(article.category || '論文')}</span>
                    <span class="slide-cover-score"><i class="fa-solid fa-fire"></i> AIスコア ${article.score}点</span>
                </div>
                <h2 class="slide-cover-title-ja">${titleJa}</h2>
                <div class="slide-cover-title-en">${titleEn}</div>
                <div class="slide-cover-meta">
                    <span><i class="fa-regular fa-bookmark"></i> ${escapeHtml(article.journal || '')}</span>
                    <span><i class="fa-regular fa-clock"></i> 掲載: ${publishedYmd || '今日'}</span>
                    <span><i class="fa-regular fa-calendar-days"></i> 論文出版: ${escapeHtml(article.pub_date || '')}</span>
                </div>
                <a href="${pubmedUrl}" target="_blank" rel="noopener noreferrer" class="slide-cover-pubmed-btn">
                    <i class="fa-solid fa-arrow-up-right-from-square"></i> PubMedで原著を開く (PMID: ${article.pmid})
                </a>
            </div>
        `;
    } else {
        // --- コンテンツスライド (1-indexed, contentSlides[currentSlideIndex - 1]) ---
        const slide = contentSlides[currentSlideIndex - 1];
        if (!slide) return;

        const slideTypeIcon = {
            "Background": "fa-book-open",
            "Methods": "fa-flask",
            "Results": "fa-chart-bar",
            "Conclusion": "fa-flag-checkered",
            "Clinical Takeaway": "fa-stethoscope"
        }[slide.slide_type] || "fa-file";

        const bulletsHtml = (slide.bullets || [])
            .map(b => `<li>${escapeHtml(b)}</li>`)
            .join("");

        slideBoxInner.innerHTML = `
            <div class="slide-content">
                <div class="slide-content-header">
                    <span class="slide-type-badge"><i class="fa-solid ${slideTypeIcon}"></i> ${escapeHtml(slide.slide_type || '')}</span>
                </div>
                <h3 class="slide-content-title">${escapeHtml(slide.title || '')}</h3>
                <ul class="slide-bullets">${bulletsHtml}</ul>
            </div>
        `;
    }

    // カウンター更新
    const counterEl = document.getElementById("slide-counter");
    if (counterEl) counterEl.textContent = `${currentSlideIndex + 1} / ${totalSlides}`;

    // ナビゲーションボタン制御
    const prevBtn = document.getElementById("btn-prev-slide");
    const nextBtn = document.getElementById("btn-next-slide");
    if (prevBtn) prevBtn.disabled = currentSlideIndex === 0;
    if (nextBtn) nextBtn.disabled = currentSlideIndex === totalSlides - 1;

    // ドット更新 (トップバーの slide-dots)
    const dotsContainer = document.getElementById("slide-dots");
    if (dotsContainer) {
        dotsContainer.innerHTML = "";
        for (let i = 0; i < totalSlides; i++) {
            const dot = document.createElement("span");
            dot.className = i === currentSlideIndex ? "dot active" : "dot";
            dot.addEventListener("click", () => {
                currentSlideIndex = i;
                renderSlideView();
            });
            dotsContainer.appendChild(dot);
        }
    }
}


// Copy Slide Content to Clipboard
function copyCurrentSlideToClipboard() {
    if (!currentArticleForModal || !currentArticleForModal.slides) return;
    const slide = currentArticleForModal.slides[currentSlideIndex];

    const textToCopy = `【${slide.title}】\n` + (slide.bullets || []).map(b => `・${b}`).join("\n");

    navigator.clipboard.writeText(textToCopy).then(() => {
        //const copyBtn = document.getElementById("btn-copy-slide");
        const originalHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = `<i class="fa-solid fa-check" style="color:#059669;"></i> コピー完了!`;
        setTimeout(() => {
            copyBtn.innerHTML = originalHtml;
        }, 1800);
    }).catch(err => {
        console.error("クリップボードコピー失敗:", err);
    });
}

// Setup DOM Event Listeners
function setupEventListeners() {
    // Refresh Button
    const refreshBtn = document.getElementById("btn-refresh");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            if (db) {
                fetchArticlesFromFirestore();
            } else {
                loadMockArticles();
            }
        });
    }

    // Category Tabs
    const categoryTabs = document.getElementById("category-tabs");
    if (categoryTabs) {
        categoryTabs.addEventListener("click", async (e) => {
            const btn = e.target.closest(".tab-btn");
            if (btn) {
                categoryTabs.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                // お気に入りタブ選択時：未取得のお気に入り記事をFirestoreから先に取得
                if (btn.dataset.category === "favorite" && db) {
                    await fetchMissingFavorites();
                }

                applyFiltersAndRender();
            }
        });
    }

    // Search Input: 300ms デバウンスでハイブリッド検索を実行
    let searchDebounceTimer = null;
    document.getElementById("search-input").addEventListener("input", () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => applyFiltersAndRender(), 300);
    });
    document.getElementById("sort-select").addEventListener("change", applyFiltersAndRender);

    // Modal Close
    document.getElementById("modal-close").addEventListener("click", closeSlideModal);
    document.getElementById("slide-modal").addEventListener("click", (e) => {
        if (e.target.id === "slide-modal") {
            closeSlideModal();
        }
    });

    // Slide Controls
    document.getElementById("btn-prev-slide").addEventListener("click", () => {
        if (currentSlideIndex > 0) {
            currentSlideIndex--;
            renderSlideView();
        }
    });

    document.getElementById("btn-next-slide").addEventListener("click", () => {
        if (!currentArticleForModal) return;
        const totalSlides = (currentArticleForModal.slides || []).length + 1; // 表紙+コンテンツ
        if (currentSlideIndex < totalSlides - 1) {
            currentSlideIndex++;
            renderSlideView();
        }
    });

    //document.getElementById("btn-copy-slide").addEventListener("click", copyCurrentSlideToClipboard);

    // Keyboard Arrow Keys for Slide Navigation
    document.addEventListener("keydown", (e) => {
        const modal = document.getElementById("slide-modal");
        if (modal.classList.contains("active")) {
            const totalSlides = currentArticleForModal ? (currentArticleForModal.slides || []).length + 1 : 1;
            if (e.key === "ArrowLeft" && currentSlideIndex > 0) {
                currentSlideIndex--;
                renderSlideView();
            } else if (e.key === "ArrowRight" && currentSlideIndex < totalSlides - 1) {
                currentSlideIndex++;
                renderSlideView();
            } else if (e.key === "Escape") {
                closeSlideModal();
            }
        }
    });
}

// Utility: Escape HTML
function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
