const APP_CONFIG = {
  apiKey: window.__GEMINI_API_KEY__ || '',
  model: window.__GEMINI_MODEL__ || 'gemini-2.0-flash',
};

const startBtn = document.getElementById('startBtn');
const submitBtn = document.getElementById('submitBtn');
const quizForm = document.getElementById('quizForm');
const quizSection = document.getElementById('quizSection');
const resultSection = document.getElementById('resultSection');
const quizTitle = document.getElementById('quizTitle');
const configWarning = document.getElementById('configWarning');

let currentQuestions = [];
let targetQuestionCount = 5;
let lastSourceText = '';
let round = 1;

if (!APP_CONFIG.apiKey || !APP_CONFIG.model) {
  startBtn.disabled = true;
  configWarning.classList.remove('hidden');
}

startBtn.addEventListener('click', async () => {
  try {
    const file = document.getElementById('fileInput').files[0];
    const numQuestions = Number(document.getElementById('numQuestions').value);

    if (!file || !numQuestions || numQuestions < 1) {
      alert('Selecciona un fitxer i un nombre de preguntes vàlid.');
      return;
    }

    targetQuestionCount = numQuestions;
    round = 1;
    lastSourceText = await file.text();
    await generateAndRenderQuiz({ apiKey: APP_CONFIG.apiKey, model: APP_CONFIG.model, sourceText: lastSourceText, count: targetQuestionCount, round });
  } catch (error) {
    console.error(error);
    alert('Error generant el test. Revisa la consola.');
  }
});

submitBtn.addEventListener('click', async () => {
  const checked = evaluateQuiz();
  renderResults(checked);

  if (checked.wrongCount > 0) {
    const shouldRetry = confirm(`Has fallat ${checked.wrongCount}. Es generarà un nou test de ${targetQuestionCount} preguntes.`);
    if (!shouldRetry) return;

    round += 1;

    try {
      await generateAndRenderQuiz({ apiKey: APP_CONFIG.apiKey, model: APP_CONFIG.model, sourceText: lastSourceText, count: targetQuestionCount, round });
    } catch (error) {
      console.error(error);
      alert('No s\'ha pogut generar el nou qüestionari.');
    }
  }
});

async function generateAndRenderQuiz({ apiKey, model, sourceText, count, round }) {
  startBtn.disabled = true;
  submitBtn.disabled = true;
  quizTitle.textContent = `Qüestionari (ronda ${round})`;
  quizForm.innerHTML = '<p>Generant preguntes...</p>';
  quizSection.classList.remove('hidden');
  resultSection.classList.add('hidden');

  const questions = await fetchQuestionsFromGemini({ apiKey, model, sourceText, count });
  currentQuestions = questions;
  renderQuiz(questions);

  startBtn.disabled = false;
  submitBtn.disabled = false;
}

function renderQuiz(questions) { quizForm.innerHTML = ''; questions.forEach((q, idx) => { const wrap = document.createElement('div'); wrap.className = 'question'; const title = document.createElement('p'); title.innerHTML = `<strong>${idx + 1}. ${escapeHtml(q.question)}</strong>`; wrap.appendChild(title); const options = document.createElement('div'); options.className = 'options'; q.options.forEach((opt, oidx) => { const id = `q${idx}_o${oidx}`; const label = document.createElement('label'); label.setAttribute('for', id); label.innerHTML = `<input type="radio" name="q${idx}" id="${id}" value="${oidx}" /> ${String.fromCharCode(65 + oidx)}. ${escapeHtml(opt)}`; options.appendChild(label); }); wrap.appendChild(options); quizForm.appendChild(wrap); }); }
function evaluateQuiz() { let correctCount = 0; const details = currentQuestions.map((q, idx) => { const selected = quizForm.querySelector(`input[name="q${idx}"]:checked`); const selectedIndex = selected ? Number(selected.value) : -1; const isCorrect = selectedIndex === q.correctIndex; if (isCorrect) correctCount += 1; return { ...q, selectedIndex, isCorrect }; }); return { details, correctCount, wrongCount: currentQuestions.length - correctCount, total: currentQuestions.length }; }
function renderResults({ details, correctCount, wrongCount, total }) { resultSection.classList.remove('hidden'); const lines = details.map((d, i) => { const className = d.isCorrect ? 'correct' : 'incorrect'; const yourAnswer = d.selectedIndex >= 0 ? d.options[d.selectedIndex] : 'No contestada'; return `<li class="${className}"><strong>${i + 1}. ${escapeHtml(d.question)}</strong><br/>La teva resposta: ${escapeHtml(yourAnswer)}<br/>Correcta: ${escapeHtml(d.options[d.correctIndex])}</li>`; }).join(''); resultSection.innerHTML = `<h2>Resultats</h2><p><strong>${correctCount}/${total}</strong> correctes.</p><p>${wrongCount === 0 ? 'Perfecte! No cal repetir.' : 'Com a mínim una malament: es pot generar un nou qüestionari del mateix tamany.'}</p><ol>${lines}</ol>`; }

async function fetchQuestionsFromGemini({ apiKey, model, sourceText, count }) {
  const prompt = `Ets un generador de tests. Basant-te EXCLUSIVAMENT en el text següent, crea ${count} preguntes tipus test en català.\n\nRetorna NOMÉS JSON vàlid amb aquest format:\n{\n  "questions": [\n    {\n      "question": "...",\n      "options": ["...", "...", "...", "..."],\n      "correctIndex": 0\n    }\n  ]\n}\n\nRegles:\n- Exactament ${count} preguntes.\n- Cada pregunta amb 4 opcions.\n- correctIndex entre 0 i 3.\n- No incloguis markdown ni text extra.\n\nText font:\n${sourceText.slice(0, 120000)}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, responseMimeType: 'application/json' } }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Resposta buida de Gemini.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`JSON invàlid rebut: ${text}`); }
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== count) throw new Error('El model no ha retornat el nombre correcte de preguntes.');
  return parsed.questions.map((q, i) => { if (!q.question || !Array.isArray(q.options) || q.options.length !== 4 || !Number.isInteger(q.correctIndex)) throw new Error(`Pregunta invàlida a l'índex ${i}`); return q; });
}

function escapeHtml(text) { return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
