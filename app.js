const DB_NAME = "EnglishTypingDB";
const STORE_NAME = "cards";
const DB_VERSION = 1;

let db;
let cards = [];
let currentCard = null;
let questionNumber = 0;
let recentCardIds = [];
let recentWrongIds = [];

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
  return text.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}
function getAccuracy(card) {
  const attempts = card.attempts || 0;
  return attempts === 0 ? null : (card.correctCount || 0) / attempts;
}
function getPriorityLabel(card) {
  const attempts = card.attempts || 0;
  const a = getAccuracy(card);
  if (attempts === 0) return "未学習・最優先";
  if (attempts < 3) return "学習初期・優先";
  if (a < 0.50) return "苦手・最優先";
  if (a < 0.70) return "苦手・優先";
  if (a < 0.90) return "要復習";
  if (a < 1.00) return "ほぼ定着";
  return "定着済み";
}
function getCardWeight(card) {
  const attempts = card.attempts || 0;
  const a = getAccuracy(card);
  if (attempts === 0) return 8.0;
  let weight = 0.8 + (1 - a) * 6.0;
  if (attempts < 3) weight += 2.0;
  if (recentWrongIds.includes(card.id)) weight += 3.5;
  return Math.max(0.8, weight);
}
function weightedRandom(items) {
  const rows = items.map(card => ({card, weight:getCardWeight(card)}));
  const total = rows.reduce((s,r) => s+r.weight, 0);
  let x = Math.random() * total;
  for (const row of rows) {
    x -= row.weight;
    if (x <= 0) return row.card;
  }
  return rows[rows.length-1].card;
}
function chooseWeightedCard() {
  if (!cards.length) {
    currentCard = null;
    $("question").textContent = "まず「単語登録」からカードを追加してください";
    $("progress").textContent = "登録単語 0件";
    $("priorityBadge")?.classList.add("hidden");
    setAnswerControlsDisabled(true);
    $("result").classList.add("hidden");
    return;
  }
  let candidates = cards.slice();
  if (cards.length > 1 && currentCard) candidates = candidates.filter(c => c.id !== currentCard.id);
  if (cards.length >= 5) {
    const filtered = candidates.filter(c => !recentCardIds.includes(c.id));
    if (filtered.length >= 2) candidates = filtered;
  }
  currentCard = weightedRandom(candidates);
  questionNumber++;
  recentCardIds.unshift(currentCard.id);
  recentCardIds = recentCardIds.slice(0,2);

  const a = getAccuracy(currentCard);
  $("question").textContent = currentCard.japanese;
  $("progress").textContent = `第${questionNumber}問・登録${cards.length}件・` +
    (a === null ? "未学習" : `正答率 ${Math.round(a*100)}%`);
  if ($("priorityBadge")) {
    $("priorityBadge").textContent = getPriorityLabel(currentCard);
    $("priorityBadge").classList.remove("hidden");
  }
  $("answer").value = "";
  $("answerControls").classList.remove("hidden");
  setAnswerControlsDisabled(false);
  $("result").classList.add("hidden");
  $("answerImage").classList.add("hidden");
  $("answerImage").removeAttribute("src");
  $("answer").focus();
}

function setAnswerControlsDisabled(disabled) {
  $("answer").disabled = disabled;
  $("checkBtn").disabled = disabled;
  $("knowBtn").disabled = disabled;
  $("dontKnowBtn").disabled = disabled;
}
function speakEnglish(text) {
  if (!text || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch (e) { console.error("speech error", e); }
}
async function recordResult(ok, mode, typed="") {
  if (!currentCard) return;
  currentCard.attempts = (currentCard.attempts || 0) + 1;
  if (ok) {
    currentCard.correctCount = (currentCard.correctCount || 0) + 1;
    currentCard.lastResult = "correct";
    currentCard.lastCorrectAt = Date.now();
    recentWrongIds = recentWrongIds.filter(id => id !== currentCard.id);
  } else {
    currentCard.lastResult = "wrong";
    currentCard.lastWrongAt = Date.now();
    recentWrongIds = recentWrongIds.filter(id => id !== currentCard.id);
    recentWrongIds.unshift(currentCard.id);
    recentWrongIds = recentWrongIds.slice(0,5);
  }
  currentCard.lastAnsweredAt = Date.now();
  currentCard.lastAnswerMode = mode;
  await putCard(currentCard);
  const idx = cards.findIndex(c => c.id === currentCard.id);
  if (idx >= 0) cards[idx] = currentCard;

  $("judgement").textContent = ok ? "○ 正解！" : "× 不正解";
  $("judgement").className = ok ? "correct" : "wrong";
  $("correctAnswer").textContent = currentCard.english;
  if (mode === "typing") {
    $("yourAnswerRow").classList.remove("hidden");
    $("yourAnswer").textContent = typed;
    $("answerMode").textContent = "判定方法：英語入力";
  } else {
    $("yourAnswerRow").classList.add("hidden");
    $("answerMode").textContent = ok ? "判定方法：自己申告「わかる」" : "判定方法：自己申告「わからない」";
  }
  const a = getAccuracy(currentCard);
  $("resultStats").textContent = `この単語：正解 ${currentCard.correctCount || 0} / 回答 ${currentCard.attempts || 0}（正答率 ${Math.round(a*100)}%）`;
  $("example").textContent = currentCard.example || "";
  if (currentCard.imageData) {
    $("answerImage").src = currentCard.imageData;
    $("answerImage").classList.remove("hidden");
  } else {
    $("answerImage").classList.add("hidden");
  }
  $("answerControls").classList.add("hidden");
  $("result").classList.remove("hidden");
  setAnswerControlsDisabled(true);
  renderList(); renderOverallStats();
  setTimeout(() => speakEnglish(currentCard.english), 120);
}
async function checkAnswer() {
  if (!currentCard) return;
  const typed = $("answer").value;
  if (!typed.trim()) { alert("英語を入力してください。"); return; }
  await recordResult(normalizeAnswer(typed) === normalizeAnswer(currentCard.english), "typing", typed);
}
async function selfReport(ok) {
  await recordResult(ok, ok ? "self-know" : "self-dontknow");
}

function resizeImage(file, maxWidth=1200, quality=0.82) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
      image.onload = () => {
        const scale = Math.min(1, maxWidth/image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width*scale);
        canvas.height = Math.round(image.height*scale);
        canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/jpeg",quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function refreshCards() {
  cards = (await getAllCards()).map(card => ({...card, attempts:card.attempts||0, correctCount:card.correctCount||0}));
  renderList(); renderOverallStats();
  $("status").textContent = `オフライン保存：${cards.length}件`;
}
function getSortedCards() {
  const mode = $("sortSelect")?.value || "weak";
  const copy = cards.slice();
  if (mode === "new") return copy.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  if (mode === "attempts") return copy.sort((a,b)=>(b.attempts||0)-(a.attempts||0));
  if (mode === "accuracy") return copy.sort((a,b)=>{
    const aa=getAccuracy(a), bb=getAccuracy(b);
    if (aa===null && bb!==null) return -1;
    if (aa!==null && bb===null) return 1;
    if (aa===null && bb===null) return 0;
    return aa-bb;
  });
  return copy.sort((a,b)=>getCardWeight(b)-getCardWeight(a));
}
function renderOverallStats() {
  if (!$("overallStats")) return;
  if (!cards.length) { $("overallStats").textContent = "まだ学習データがありません。"; return; }
  const attempts = cards.reduce((s,c)=>s+(c.attempts||0),0);
  const correct = cards.reduce((s,c)=>s+(c.correctCount||0),0);
  const weak = cards.filter(c=>{const a=getAccuracy(c); return a!==null && a<0.70;}).length;
  const fresh = cards.filter(c=>(c.attempts||0)===0).length;
  $("overallStats").textContent = attempts===0
    ? `登録 ${cards.length}件・未学習 ${fresh}件`
    : `全体正答率 ${Math.round(correct/attempts*100)}%・苦手 ${weak}件・未学習 ${fresh}件`;
}
function renderList() {
  const list = $("wordList");
  list.innerHTML = "";
  if (!cards.length) { list.innerHTML = "<p>まだ登録されていません。</p>"; return; }
  getSortedCards().forEach(card => {
    const item = document.createElement("div"); item.className = "word-item";
    const jp = document.createElement("strong"); jp.textContent = card.japanese;
    const en = document.createElement("span"); en.textContent = card.english;
    const attempts = card.attempts||0, correct=card.correctCount||0, a=getAccuracy(card);
    const stats = document.createElement("span"); stats.className="meta";
    stats.textContent = attempts===0 ? "未学習" : `正解 ${correct} / 回答 ${attempts}・正答率 ${Math.round(a*100)}%`;
    const weak = document.createElement("span"); weak.className="weakness"; weak.textContent=getPriorityLabel(card);
    const actions=document.createElement("div"); actions.className="word-actions";
    const edit=document.createElement("button"); edit.className="edit-btn"; edit.textContent="修正";
    edit.addEventListener("click",()=>openEditModal(card.id));
    const del=document.createElement("button"); del.className="danger"; del.textContent="削除";
    del.addEventListener("click", async()=>{
      if(!confirm(`「${card.japanese}」を削除しますか？`)) return;
      await deleteCard(card.id);
      recentCardIds=recentCardIds.filter(id=>id!==card.id);
      recentWrongIds=recentWrongIds.filter(id=>id!==card.id);
      await refreshCards(); chooseWeightedCard();
    });
    actions.append(edit,del); item.append(jp,en,stats,weak,actions); list.appendChild(item);
  });
}
function openEditModal(id) {
  const card = cards.find(c=>c.id===id); if(!card) return;
  $("editId").value=card.id;
  $("editJapanese").value=card.japanese||"";
  $("editEnglish").value=card.english||"";
  $("editExample").value=card.example||"";
  $("editImageInput").value="";
  $("removeImageCheck").checked=false;
  if(card.imageData){
    $("currentEditImage").src=card.imageData;
    $("currentImageWrap").classList.remove("hidden");
  } else {
    $("currentEditImage").removeAttribute("src");
    $("currentImageWrap").classList.add("hidden");
  }
  $("editModal").classList.remove("hidden");
}
function closeEditModal(){ $("editModal").classList.add("hidden"); $("editForm").reset(); }
async function saveEdit(e){
  e.preventDefault();
  const card=cards.find(c=>c.id===$("editId").value); if(!card) return;
  card.japanese=$("editJapanese").value.trim();
  card.english=$("editEnglish").value.trim();
  card.example=$("editExample").value.trim();
  const f=$("editImageInput").files[0];
  if(f) card.imageData=await resizeImage(f);
  else if($("removeImageCheck").checked) card.imageData="";
  card.updatedAt=Date.now();
  await putCard(card);
  if(currentCard && currentCard.id===card.id) currentCard=card;
  await refreshCards(); closeEditModal(); alert("修正内容を保存しました。");
}
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(el=>el.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(el=>el.classList.remove("active"));
  $(id).classList.add("active");
  document.querySelector(`.tab[data-screen="${id}"]`).classList.add("active");
  if(id==="list"){renderList();renderOverallStats();}
}
async function exportBackup() {
  const exportCards=await getAllCards();
  const blob=new Blob([JSON.stringify({app:"EnglishTypingPWA",version:3,exportedAt:new Date().toISOString(),cards:exportCards},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const link=document.createElement("a");
  link.href=url; link.download=`english-cards-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(url);
}
async function importBackup(file) {
  const data=JSON.parse(await file.text());
  if(!data || !Array.isArray(data.cards)) throw new Error("このファイルは正しいバックアップではありません。");
  for(const card of data.cards){ if(card.id && card.japanese && card.english) await putCard(card); }
  await refreshCards(); chooseWeightedCard();
}

async function init() {
  db=await openDB(); await refreshCards();
  document.querySelectorAll(".tab").forEach(tab=>tab.addEventListener("click",()=>showScreen(tab.dataset.screen)));
  $("checkBtn").addEventListener("click",checkAnswer);
  $("knowBtn").addEventListener("click",()=>selfReport(true));
  $("dontKnowBtn").addEventListener("click",()=>selfReport(false));
  $("answer").addEventListener("keydown",e=>{if(e.key==="Enter" && !$("checkBtn").disabled) checkAnswer();});
  $("nextBtn").addEventListener("click",chooseWeightedCard);
  $("speakBtn").addEventListener("click",()=>{ if(currentCard) speakEnglish(currentCard.english); });
  $("addForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const file=$("imageInput").files[0]; const imageData=file ? await resizeImage(file) : "";
    const card={id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`,
      japanese:$("japanese").value.trim(),english:$("english").value.trim(),example:$("exampleInput").value.trim(),
      imageData,attempts:0,correctCount:0,createdAt:Date.now()};
    await putCard(card); $("addForm").reset(); await refreshCards();
    alert("登録しました。未学習カードとして優先的に出題されます。");
    showScreen("quiz"); chooseWeightedCard();
  });
  $("deleteAllBtn").addEventListener("click",async()=>{
    if(!cards.length || !confirm("すべての単語を削除します。元に戻せません。")) return;
    await clearCards(); recentCardIds=[]; recentWrongIds=[]; await refreshCards(); chooseWeightedCard();
  });
  $("sortSelect")?.addEventListener("change",renderList);
  $("editForm").addEventListener("submit",saveEdit);
  $("closeEditBtn").addEventListener("click",closeEditModal);
  $("cancelEditBtn").addEventListener("click",closeEditModal);
  $("editModal").addEventListener("click",e=>{ if(e.target===$("editModal")) closeEditModal(); });
  $("exportBtn").addEventListener("click",exportBackup);
  $("importInput").addEventListener("change",async e=>{
    const file=e.target.files[0]; if(!file) return;
    try{await importBackup(file);alert("バックアップを読み込みました。");}
    catch(err){alert(err.message);} finally{e.target.value="";}
  });
  chooseWeightedCard();
  if("serviceWorker" in navigator){
    try{const reg=await navigator.serviceWorker.register("./sw.js"); reg.update();}
    catch(err){console.error("Service Worker registration failed:",err);}
  }
}
init().catch(err=>{console.error(err);$("status").textContent="起動エラー";alert("アプリの起動に失敗しました："+err.message);});
