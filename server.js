// Langoo : serveur IA (Node 18+, aucune dépendance).
// Lancer :  ANTHROPIC_API_KEY=sk-ant-...  node server.js
// Il sert aussi l'appli sur http://localhost:8787 (installable en PWA).
const http = require('http'), fs = require('fs'), path = require('path');
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LANGOO_MODEL || 'claude-sonnet-5-5';
const PORT = process.env.PORT || 8787;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const SYSTEM = `Tu es un correcteur d'anglais bienveillant mais exigeant pour un étudiant francophone (niveau A2 vers C2).
Réponds UNIQUEMENT par un objet JSON valide, sans texte autour ni balises, en français sauf pour les exemples anglais :
{"score": entier 0-10, "summary": "bilan en 1-2 phrases", "corrections": [{"from": "texte fautif", "to": "forme correcte", "why": "règle en quelques mots"}], "improved": "version plus naturelle en anglais (écriture seulement, sinon vide)", "tips": ["conseils courts et concrets"]}
Écriture : juge grammaire, vocabulaire, naturel, respect de la consigne et du niveau visé. Liste au maximum 6 corrections.
Prononciation : tu reçois la phrase cible, ce que la reconnaissance vocale a compris et sa confiance. Tu ne peux pas entendre l'audio : base-toi sur les écarts de transcription, explique les sons probablement difficiles pour un francophone (th, h aspiré, r, voyelles courtes/longues, accent de mot) et dis honnêtement que c'est une estimation. "corrections" liste les mots ratés (from = entendu, to = attendu, why = conseil de prononciation).`;

function prompt(b) {
  if (b.kind === 'writing')
    return `ÉCRITURE\nNiveau visé : ${b.level || '?'}\nThème : ${b.topic || ''}\nMots à utiliser : ${(b.words || []).join(', ')}\nTexte de l'élève :\n${String(b.text).slice(0, 1500)}`;
  if (b.kind === 'speech')
    return `PRONONCIATION\nPhrase cible : ${String(b.target).slice(0, 300)}\nCompris par la reconnaissance vocale : ${String(b.heard).slice(0, 300)}\nConfiance : ${b.confidence || 'inconnue'} %`;
  return null;
}

async function evaluate(b) {
  const p = prompt(b);
  if (!p) throw new Error('requête invalide');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 900, system: SYSTEM, messages: [{ role: 'user', content: p }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'erreur API ' + r.status);
  const txt = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('').replace(/```json|```/g, '').trim();
  try { return JSON.parse(txt); } catch (e) { return { summary: txt }; }
}

http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Private-Network': 'true' };
  const send = (c, o, h = {}) => { res.writeHead(c, Object.assign({ 'content-type': 'application/json' }, cors, h)); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  if (req.method === 'OPTIONS') return send(204, '');
  if (req.method === 'POST' && req.url === '/api/eval') {
    if (!KEY) return send(500, { error: 'ANTHROPIC_API_KEY manquante côté serveur' });
    let body = '';
    req.on('data', d => { body += d; if (body.length > 20000) req.destroy(); });
    req.on('end', async () => {
      try { send(200, await evaluate(JSON.parse(body))); }
      catch (e) { send(500, { error: e.message }); }
    });
    return;
  }
  // Fichiers de l'appli
  let f = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(__dirname)) return send(403, { error: 'interdit' });
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  fs.readFile(f, (e, d) => e ? send(404, { error: 'introuvable' }) : (res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }), res.end(d)));
}).listen(PORT, () => console.log('Langoo IA prête : http://localhost:' + PORT + (KEY ? '' : '  (⚠ ANTHROPIC_API_KEY absente)')));
