const DB_NAME = "EnglishTypingDB";
const STORE_NAME = "cards";
const DB_VERSION = 1;

let db;
let cards = [];
let currentCard = null;
let questionNumber = 0;

const $ = (id) => document.getElementById(id);

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllCards() {
  const tx = db.transaction(STORE_NAME, "readonly");
  return requestToPromise(tx.objectStore(STORE_NAME).getAll());
}

async function putCard(card) {
  const tx = db.transaction(STORE_NAME, "readwrite");
  await requestToPromise(tx.objectStore(STORE_NAME).put(card));
}

async function deleteCard(id) {
  const tx = db.transaction(STORE_NAME, "readwrite");
  await requestToPromise(tx.objectStore(STORE_NAME).delete(id));
}

async function clearCards() {
  const tx = db.transaction(STORE_NAME, "readwrite");
  await requestToPromise(tx.objectStore(STORE_NAME).clear());
}

function normalizeAnswer(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
}

function chooseRandomCard() {
  if (!cards.length) {
    currentCard = null;
    $("question").textContent = "まず「単語登録」からカードを追加してください";
    $("progress").textContent = "登録単語 0件";
    $("answer").disabled = true;
    $("checkBtn").disabled = true;
    $("result").classList.add("hidden");
    return;
  }

  let candidates = cards;
  if (cards.length > 1 && currentCard) {
    candidates = cards.filter(card => card.id !== currentCard.id);
  }

  currentCard = candidates[Math.floor(Math.random() * candidates.length)];
  questionNumber += 1;
  $("question").textContent = currentCard.japanese;
  $("progress").textContent =
    `第${questionNumber}問・登録${cards.length}件・正解${currentCard.correctCount || 0}／回答${currentCard.attempts || 0}`;
  $("answer").value = "";
  $("answer").disabled = false;
  $("checkBtn").disabled = false;
  $("result").classList.add("hidden");
  $("answerImage").classList.add("hidden");
  $("answerImage").removeAttribute("src");
  $("answer").focus();
}

async function checkAnswer() {
  if (!currentCard) return;
  const typed = $("answer").value;
  if (!typed.trim()) {
    alert("英語を入力してください。");
    return;
  }

  const isCorrect = normalizeAnswer(typed) === normalizeAnswer(currentCard.english);
  currentCard.attempts = (currentCard.attempts || 0) + 1;
  if (isCorrect) currentCard.correctCount = (currentCard.correctCount || 0) + 1;
  await putCard(currentCard);

  $("judgement").textContent = isCorrect ? "○ 正解！" : "× 惜しい！";
  $("judgement").className = isCorrect ? "correct" : "wrong";
  $("correctAnswer").textContent = currentCard.english;
  $("yourAnswer").textContent = typed;
  $("example").textContent = currentCard.example || "";

  if (currentCard.imageData) {
    $("answerImage").src = currentCard.imageData;
    $("answerImage").classList.remove("hidden");
  }
  $("result").classList.remove("hidden");
  $("checkBtn").disabled = true;
}

function resizeImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      image.onload = () => {
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function refreshCards() {
  cards = await getAllCards();
  cards.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  renderList();
  $("status").textContent = `オフライン保存：${cards.length}件`;
}

function renderList() {
  const list = $("wordList");
  list.innerHTML = "";
  if (!cards.length) {
    list.innerHTML = "<p>まだ登録されていません。</p>";
    return;
  }

  cards.forEach(card => {
    const item = document.createElement("div");
    item.className = "word-item";

    const jp = document.createElement("strong");
    jp.textContent = card.japanese;
    const en = document.createElement("span");
    en.textContent = card.english;
    const stats = document.createElement("span");
    stats.textContent = `正解 ${card.correctCount || 0}／回答 ${card.attempts || 0}`;

    const actions = document.createElement("div");
    actions.className = "word-actions";
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "削除";
    del.addEventListener("click", async () => {
      if (!confirm(`「${card.japanese}」を削除しますか？`)) return;
      await deleteCard(card.id);
      await refreshCards();
      chooseRandomCard();
    });

    actions.appendChild(del);
    item.append(jp, en, stats, actions);
    list.appendChild(item);
  });
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
  $(screenId).classList.add("active");
  document.querySelector(`.tab[data-screen="${screenId}"]`).classList.add("active");
}

async function exportBackup() {
  const exportCards = await getAllCards();
  const blob = new Blob([JSON.stringify({
    app: "EnglishTypingPWA",
    version: 1,
    exportedAt: new Date().toISOString(),
    cards: exportCards
  }, null, 2)], { type: "application/json" });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `english-cards-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.cards)) {
    throw new Error("このファイルは正しいバックアップではありません。");
  }
  for (const card of data.cards) {
    if (!card.id || !card.japanese || !card.english) continue;
    await putCard(card);
  }
  await refreshCards();
  chooseRandomCard();
}

async function init() {
  db = await openDB();
  await refreshCards();

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => showScreen(tab.dataset.screen));
  });

  $("checkBtn").addEventListener("click", checkAnswer);
  $("answer").addEventListener("keydown", event => {
    if (event.key === "Enter" && !$("checkBtn").disabled) checkAnswer();
  });
  $("nextBtn").addEventListener("click", chooseRandomCard);
  $("speakBtn").addEventListener("click", () => {
    if (!currentCard || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(currentCard.english);
    utterance.lang = "en-US";
    speechSynthesis.speak(utterance);
  });

  $("addForm").addEventListener("submit", async event => {
    event.preventDefault();
    const imageFile = $("imageInput").files[0];
    let imageData = "";
    if (imageFile) imageData = await resizeImage(imageFile);

    const card = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      japanese: $("japanese").value.trim(),
      english: $("english").value.trim(),
      example: $("exampleInput").value.trim(),
      imageData,
      attempts: 0,
      correctCount: 0,
      createdAt: Date.now()
    };

    await putCard(card);
    $("addForm").reset();
    await refreshCards();
    alert("登録しました。");
    showScreen("quiz");
    chooseRandomCard();
  });

  $("deleteAllBtn").addEventListener("click", async () => {
    if (!cards.length) return;
    if (!confirm("すべての単語を削除します。元に戻せません。")) return;
    await clearCards();
    await refreshCards();
    chooseRandomCard();
  });

  $("exportBtn").addEventListener("click", exportBackup);
  $("importInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await importBackup(file);
      alert("バックアップを読み込みました。");
    } catch (error) {
      alert(error.message);
    } finally {
      event.target.value = "";
    }
  });

  chooseRandomCard();

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.error("Service Worker registration failed:", error);
    }
  }
}

init().catch(error => {
  console.error(error);
  $("status").textContent = "起動エラー";
  alert("アプリの起動に失敗しました：" + error.message);
});
