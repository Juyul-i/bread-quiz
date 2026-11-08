// ===================================
// Supabase 설정: 아래 두 값을 본인의 프로젝트 값으로 입력하세요.
// Publishable key는 브라우저에서 사용해도 되는 키입니다.
// Secret key / service_role key는 절대 입력하지 마세요.
// ===================================
const SUPABASE_URL = "https://vnqyokvwkhtbiglhajsm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_2rs0lW9fwBEz6j088tyWZA_XtB6tD9o";
const ADMIN_UID = "5cac4889-93fd-48f9-8604-90fe7c8107d7";
const BUCKET_NAME = "bread-images";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

let breads = [];
let editingId = null;
let selectedImageFile = null;
let selectedImagePreview = null;

let questions = [];
let currentIndex = 0;
let score = 0;
let answered = false;
let hintIndex = 0;
let wrongQuestions = [];
let isReviewMode = false;
let currentSession = null;

const $ = (id) => document.getElementById(id);
const quizTab = $("quiz-tab");
const adminTab = $("admin-tab");
const quizSection = $("quiz-section");
const adminSection = $("admin-section");
const breadForm = $("bread-form");
const nameInput = $("bread-name");
const hintsInput = $("bread-hints");
const fileInput = $("bread-file");
const preview = $("image-preview");
const uploadGuide = $("upload-guide");

function setStatus(message, isError = false) {
  const status = $("app-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function isConfigured() {
  return SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_") &&
    !SUPABASE_PUBLISHABLE_KEY.includes("여기에_") &&
    !ADMIN_UID.includes("여기에_");
}

function isAdminUser(session) {
  return Boolean(session?.user?.id && session.user.id === ADMIN_UID);
}

async function loadBreads() {
  setStatus("빵 데이터를 불러오는 중이에요.");
  const { data, error } = await supabaseClient
    .from("breads")
    .select("id, name, image_url, hints")
    .order("id", { ascending: true });

  if (error) {
    console.error(error);
    setStatus("빵 데이터를 불러오지 못했어요. Supabase 연결과 SELECT 정책을 확인해 주세요.", true);
    $("quiz-content").innerHTML =
      '<p class="empty-message">데이터를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>';
    return;
  }

  breads = (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    image: row.image_url,
    hints: Array.isArray(row.hints) ? row.hints : []
  }));

  setStatus(`빵 데이터 ${breads.length}개를 불러왔어요.`);
  renderBreadList();
  startQuiz();
}

function showTab(tab) {
  const isQuiz = tab === "quiz";
  quizTab.classList.toggle("active", isQuiz);
  adminTab.classList.toggle("active", !isQuiz);
  quizSection.classList.toggle("hidden", !isQuiz);
  adminSection.classList.toggle("hidden", isQuiz);
  if (isQuiz) startQuiz();
  else renderBreadList();
}

quizTab.addEventListener("click", () => showTab("quiz"));
adminTab.addEventListener("click", () => showTab("admin"));

function updateAuthUI(session) {
  currentSession = session;
  const admin = isAdminUser(session);
  $("login-area").classList.toggle("hidden", admin);
  $("admin-content").classList.toggle("hidden", !admin);
  adminTab.classList.toggle("hidden", false);

  if (session && !admin) {
    $("login-message").textContent = "이 계정에는 관리자 권한이 없어요.";
  } else {
    $("login-message").textContent = "";
  }
  if (admin) renderBreadList();
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isConfigured()) {
    $("login-message").textContent = "script.js의 Publishable key와 관리자 UID를 먼저 입력해 주세요.";
    return;
  }

  const button = $("login-button");
  button.disabled = true;
  button.textContent = "로그인 중...";
  $("login-message").textContent = "";

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-password").value
  });

  button.disabled = false;
  button.textContent = "로그인";

  if (error) {
    $("login-message").textContent = "로그인에 실패했어요. 이메일과 비밀번호를 확인해 주세요.";
    console.error(error);
    return;
  }

  updateAuthUI(data.session);
  if (!isAdminUser(data.session)) {
    await supabaseClient.auth.signOut();
    updateAuthUI(null);
    $("login-message").textContent = "관리자 계정이 아니에요.";
    return;
  }
  $("login-password").value = "";
  setStatus("관리자로 로그인했어요.");
});

$("logout-button").addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    setStatus("로그아웃에 실패했어요.", true);
    return;
  }
  resetForm();
  updateAuthUI(null);
  showTab("quiz");
  setStatus("로그아웃했어요.");
});

supabaseClient.auth.onAuthStateChange((_event, session) => {
  updateAuthUI(session);
});

async function compressImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일을 선택해 주세요.");
  if (file.size > 10 * 1024 * 1024) throw new Error("사진은 10MB 이하로 선택해 주세요.");

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("사진을 읽을 수 없어요."));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("사진을 열 수 없어요."));
    img.src = dataUrl;
  });

  const maxSize = 900;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
  if (!blob) throw new Error("사진을 압축하지 못했어요.");
  return blob;
}

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    selectedImageFile = await compressImage(file);
    selectedImagePreview = URL.createObjectURL(selectedImageFile);
    preview.src = selectedImagePreview;
    preview.classList.add("visible");
    uploadGuide.textContent = "사진 변경하기";
  } catch (error) {
    alert(error.message);
    fileInput.value = "";
  }
});

async function uploadImage(blob) {
  const filePath = `${crypto.randomUUID()}.jpg`;
  const { error } = await supabaseClient.storage
    .from(BUCKET_NAME)
    .upload(filePath, blob, {
      contentType: "image/jpeg",
      upsert: false
    });

  if (error) throw error;

  const { data } = supabaseClient.storage.from(BUCKET_NAME).getPublicUrl(filePath);
  return data.publicUrl;
}

breadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdminUser(currentSession)) {
    alert("관리자 로그인이 필요해요.");
    return;
  }

  const name = nameInput.value.trim();
  const hints = hintsInput.value.split("\n").map((hint) => hint.trim()).filter(Boolean);
  if (!name) return alert("빵 이름을 입력해 주세요.");

  const duplicate = breads.some((bread) =>
    bread.name === name && String(bread.id) !== String(editingId)
  );
  if (duplicate) return alert("이미 등록된 빵 이름이에요.");

  const existing = breads.find((bread) => String(bread.id) === String(editingId));
  if (!selectedImageFile && !existing?.image) {
    return alert("빵 사진을 선택해 주세요.");
  }

  const saveButton = $("save-button");
  saveButton.disabled = true;
  saveButton.textContent = "저장 중...";

  try {
    let imageUrl = existing?.image || null;
    if (selectedImageFile) imageUrl = await uploadImage(selectedImageFile);

    const row = { name, image_url: imageUrl, hints };
    let result;

    if (editingId !== null) {
      result = await supabaseClient.from("breads").update(row).eq("id", editingId);
    } else {
      result = await supabaseClient.from("breads").insert(row);
    }

    if (result.error) throw result.error;

    alert(editingId !== null ? "빵 정보를 수정했어요!" : "빵을 등록했어요!");
    resetForm();
    await loadBreads();
  } catch (error) {
    console.error(error);
    alert("저장하지 못했어요. 관리자 UID와 RLS 정책을 확인해 주세요.\n" + (error.message || ""));
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = editingId !== null ? "수정 내용 저장" : "빵 등록하기";
  }
});

function resetForm() {
  editingId = null;
  selectedImageFile = null;
  if (selectedImagePreview) URL.revokeObjectURL(selectedImagePreview);
  selectedImagePreview = null;
  breadForm.reset();
  preview.src = "";
  preview.classList.remove("visible");
  uploadGuide.textContent = "📷 사진을 선택해 주세요";
  $("save-button").textContent = "빵 등록하기";
  $("cancel-button").classList.add("hidden");
}

$("cancel-button").addEventListener("click", resetForm);

function renderBreadList() {
  const list = $("bread-list");
  list.innerHTML = "";
  $("bread-count").textContent = `${breads.length}개`;

  if (!isAdminUser(currentSession)) return;
  if (!breads.length) {
    list.innerHTML = '<p class="empty-message">아직 등록된 빵이 없어요.</p>';
    return;
  }

  breads.forEach((bread) => {
    const item = document.createElement("div");
    item.className = "bread-item";

    const img = document.createElement("img");
    img.src = bread.image;
    img.alt = bread.name;

    const info = document.createElement("div");
    info.className = "bread-item-info";
    const title = document.createElement("strong");
    title.textContent = bread.name;
    const description = document.createElement("p");
    description.textContent = `힌트 ${bread.hints.length}개`;
    info.append(title, description);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const editButton = document.createElement("button");
    editButton.className = "edit-button";
    editButton.textContent = "수정";
    editButton.addEventListener("click", () => editBread(bread.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.textContent = "삭제";
    deleteButton.addEventListener("click", () => deleteBread(bread.id));

    actions.append(editButton, deleteButton);
    item.append(img, info, actions);
    list.appendChild(item);
  });
}

function editBread(id) {
  const bread = breads.find((item) => String(item.id) === String(id));
  if (!bread) return;
  editingId = id;
  selectedImageFile = null;
  nameInput.value = bread.name;
  hintsInput.value = bread.hints.join("\n");
  preview.src = bread.image;
  preview.classList.add("visible");
  uploadGuide.textContent = "사진 변경하기";
  $("save-button").textContent = "수정 내용 저장";
  $("cancel-button").classList.remove("hidden");
  breadForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteBread(id) {
  const bread = breads.find((item) => String(item.id) === String(id));
  if (!bread || !confirm(`"${bread.name}"을(를) 삭제할까요?`)) return;

  const { error } = await supabaseClient.from("breads").delete().eq("id", id);
  if (error) {
    console.error(error);
    alert("삭제하지 못했어요. 관리자 로그인과 RLS 정책을 확인해 주세요.");
    return;
  }

  if (String(editingId) === String(id)) resetForm();
  await loadBreads();
  alert("삭제했어요!");
}

// ===================================
// 퀴즈 기능
// ===================================
function startQuiz() {
  const uniqueBreads = [...new Map(breads.map((bread) => [bread.name, bread])).values()];
  const content = $("quiz-content");

  if (uniqueBreads.length < 4) {
    content.innerHTML = `<p class="empty-message">퀴즈를 시작하려면 서로 다른 빵을 최소 4개 등록해 주세요.<br><br>현재 등록된 빵: ${uniqueBreads.length}개</p>`;
    $("progress").textContent = "0 / 0";
    $("progress-fill").style.width = "0%";
    return;
  }

  const requestedCount = Number($("question-count").value);
  const shuffled = [...uniqueBreads].sort(() => Math.random() - 0.5);
  questions = shuffled.slice(0, Math.min(requestedCount, shuffled.length));
  currentIndex = 0;
  score = 0;
  wrongQuestions = [];
  isReviewMode = false;
  showQuestion();
}

$("question-count").addEventListener("change", () => {
  if (!$("quiz-section").classList.contains("hidden")) startQuiz();
});

function showQuestion() {
  if (currentIndex >= questions.length) return showResult();

  answered = false;
  hintIndex = 0;
  const bread = questions[currentIndex];
  $("progress").textContent = `${currentIndex + 1} / ${questions.length}`;
  $("progress-fill").style.width = `${(currentIndex / questions.length) * 100}%`;

  const wrongAnswers = breads
    .filter((item) => item.name !== bread.name)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  const options = [...wrongAnswers, bread].sort(() => Math.random() - 0.5);

  $("quiz-content").innerHTML = `
    <img id="quiz-image" alt="빵 사진">
    <h2>이 빵의 이름은 무엇일까요?</h2>
    <div class="choices" id="quiz-choices"></div>
    <button class="hint-button" id="quiz-hint">💡 힌트 보기</button>
    <p class="hint-text" id="quiz-hint-text"></p>
    <p id="quiz-feedback"></p>
    <button class="next-button" id="quiz-next" disabled>다음 문제</button>
  `;
  $("quiz-image").src = bread.image;

  options.forEach((option) => {
    const button = document.createElement("button");
    button.className = "choice-button";
    button.textContent = option.name;
    button.addEventListener("click", () => checkAnswer(option.id));
    $("quiz-choices").appendChild(button);
  });

  $("quiz-hint").addEventListener("click", showHint);
  $("quiz-next").addEventListener("click", () => {
    currentIndex++;
    showQuestion();
  });
}

function checkAnswer(selectedId) {
  if (answered) return;
  answered = true;
  const correct = questions[currentIndex];

  document.querySelectorAll(".choice-button").forEach((button) => {
    button.disabled = true;
    if (button.textContent === correct.name) button.classList.add("correct");
  });

  const feedback = $("quiz-feedback");
  if (String(selectedId) === String(correct.id)) {
    score++;
    feedback.textContent = "정답이에요! 🎉";
  } else {
    wrongQuestions.push(correct);
    feedback.textContent = `아쉬워요! 정답은 ${correct.name}입니다.`;
    document.querySelectorAll(".choice-button").forEach((button) => {
      if (button.textContent === correct.name) return;
      if (button.textContent === questions[currentIndex].name) button.classList.add("wrong");
    });
  }
  $("quiz-next").disabled = false;
}

function showHint() {
  const hints = questions[currentIndex].hints;
  if (hintIndex < hints.length) {
    $("quiz-hint-text").textContent = hints[hintIndex++];
  } else {
    $("quiz-hint-text").textContent = "더 이상 힌트가 없어요!";
  }
}

function showResult() {
  $("progress").textContent = `${questions.length} / ${questions.length}`;
  $("progress-fill").style.width = "100%";
  const accuracy = Math.round((score / questions.length) * 100);
  const content = $("quiz-content");

  if (isReviewMode) {
    content.innerHTML = `
      <h2>오답 복습 결과 🎯</h2>
      <h1 class="result-score">${score} / ${questions.length}</h1>
      <p class="result-text">정답률: ${accuracy}%</p>
      <p class="result-text">${wrongQuestions.length === 0 ? "모든 오답을 맞혔어요! 복습 완료 🎉" : `아직 ${wrongQuestions.length}문제가 남았어요.`}</p>
      ${wrongQuestions.length ? '<button class="next-button" id="retry-wrong">남은 오답 다시 풀기</button>' : ""}
      <button class="hint-button" id="restart-button">처음부터 다시 풀기</button>
    `;
  } else {
    content.innerHTML = `
      <h2>퀴즈 완료! 🎉</h2>
      <h1 class="result-score">${score} / ${questions.length}</h1>
      <p class="result-text">정답률: ${accuracy}%</p>
      <p class="result-text">틀린 문제: ${wrongQuestions.length}개</p>
      ${wrongQuestions.length ? `<button class="next-button" id="retry-wrong">오답만 다시 풀기 (${wrongQuestions.length}개)</button>` : '<p class="result-text">완벽해요! 모든 문제를 맞혔어요! 🏆</p>'}
      <button class="hint-button" id="restart-button">처음부터 다시 풀기</button>
    `;
  }

  const retryButton = $("retry-wrong");
  if (retryButton) retryButton.addEventListener("click", retryWrongQuestions);
  $("restart-button").addEventListener("click", startQuiz);
} 

function retryWrongQuestions() {
  questions = [...wrongQuestions];
  wrongQuestions = [];
  currentIndex = 0;
  score = 0;
  isReviewMode = true;
  showQuestion();
}

// ===================================
// 최초 실행
// ===================================
async function initialize() {
  if (!isConfigured()) {
    setStatus("script.js에서 Publishable key와 관리자 UID를 입력한 뒤 새로고침해 주세요.", true);
  }
  const { data } = await supabaseClient.auth.getSession();
  updateAuthUI(data.session);
  await loadBreads();
}
initialize();
