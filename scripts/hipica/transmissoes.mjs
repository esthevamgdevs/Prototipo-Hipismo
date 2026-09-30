// Salta · transmissões automáticas da HorsePix
// Lê o feed público do canal no YouTube, desmonta o título de cada vídeo
// ("DIA 02 - 30/09 - PISTA 1 - CSN3* CIDADE DE CAMPINAS - Horsepix") e associa ao
// torneio certo pelo nome e pela data. O que não encontra torneio fica registrado
// para conferência, sem ser encaixado em lugar errado.
import fs from 'node:fs/promises';
import path from 'node:path';

const CANAL = process.env.HORSEPIX_CANAL || 'https://www.youtube.com/@Horsepix';
const FEED = process.env.HORSEPIX_FEED || 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const UA = 'Mozilla/5.0 (compatible; SaltaApp/0.2; +https://github.com/esthevamgdevs/Prototipo-Hipismo)';
const MINIMO = 0.6; // quanto dos nomes precisa coincidir para associar ao torneio

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const IGNORAR = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'A', 'O', 'HORSEPIX', 'PISTA', 'DIA', 'AO', 'VIVO']);
const palavras = s => new Set(norm(s).split(' ').filter(w => w && !IGNORAR.has(w) && !/^20\d\d$/.test(w)));
const xml = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const dataBR = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const somar = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// "DIA 02 - 30/09 - PISTA 1 - CSN3* CIDADE DE CAMPINAS - Horsepix"
export function lerTitulo(titulo) {
  const partes = titulo.split(/\s+[-–|]\s+/).map(x => x.trim()).filter(Boolean);
  if (partes.length && /^horse\s*pix$/i.test(partes[partes.length - 1])) partes.pop();
  let dia = null, data = null, pista = null;
  const resto = [];
  for (const p of partes) {
    let m;
    if (dia === null && (m = p.match(/^DIA\s*0?(\d{1,2})$/i))) { dia = +m[1]; continue; }
    if (!data && (m = p.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) { data = { d: +m[1], m: +m[2], a: m[3] ? +m[3] : null }; continue; }
    if (!pista && /^PISTA\b/i.test(p)) { pista = p; continue; }
    resto.push(p);
  }
  return { dia, data, pista, nome: resto.join(' - ') };
}

export function associar(video, torneios) {
  const pv = palavras(video.nome);
  if (pv.size < 2) return null;
  let melhor = null;
  for (const t of torneios) {
    if (!t.inicio || !t.fim || /cancel/i.test(t.status || '')) continue;
    if (video.dataISO < somar(t.inicio, -1) || video.dataISO > somar(t.fim, 1)) continue;
    const pt = palavras(t.nome);
    let comuns = 0;
    for (const w of pv) if (pt.has(w)) comuns++;
    const nota = comuns / Math.max(pv.size, pt.size);
    if (nota >= MINIMO && (!melhor || nota > melhor.nota)) melhor = { t, nota };
  }
  return melhor;
}

async function pegarTexto(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}

export async function atualizarTransmissoes({ saida, torneios }) {
  const arq = path.join(saida, 'transmissoes-auto.json');
  let atual = { canal: null, porTorneio: {}, semTorneio: [] };
  try { atual = { ...atual, ...JSON.parse(await fs.readFile(arq, 'utf8')) }; } catch {}

  // 1) identificador do canal (descoberto uma vez e guardado no próprio arquivo)
  if (!atual.canal) {
    const pagina = await pegarTexto(CANAL);
    const m = pagina.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/) || pagina.match(/channel\/(UC[\w-]{22})/);
    if (!m) { console.warn('Transmissões: não achei o identificador do canal da HorsePix.'); return; }
    atual.canal = m[1];
  }

  // 2) vídeos mais recentes do canal
  const feed = await pegarTexto(FEED + atual.canal);
  const videos = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    yt: (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1],
    titulo: xml((e.match(/<title>([^<]*)<\/title>/) || [])[1] || ''),
    publicado: (e.match(/<published>([^<]+)<\/published>/) || [])[1],
  })).filter(v => v.yt && v.titulo);

  const jaConhecidos = new Set([
    ...Object.values(atual.porTorneio).flat().map(x => x.yt),
    ...atual.semTorneio.map(x => x.yt),
  ]);
  let novos = 0, sem = 0;
  for (const v of videos) {
    if (jaConhecidos.has(v.yt)) continue;
    const lido = lerTitulo(v.titulo);
    const anoPub = v.publicado ? +dataBR(v.publicado).slice(0, 4) : new Date().getFullYear();
    // a data escrita no título vale mais que a data de publicação do vídeo
    const dataISO = lido.data
      ? `${lido.data.a ? (lido.data.a < 100 ? 2000 + lido.data.a : lido.data.a) : anoPub}-${String(lido.data.m).padStart(2, '0')}-${String(lido.data.d).padStart(2, '0')}`
      : (v.publicado ? dataBR(v.publicado) : null);
    if (!dataISO) continue;
    const achou = associar({ nome: lido.nome, dataISO }, torneios);
    const item = { yt: v.yt, dia: dataISO, titulo: lido.pista ? lido.pista.replace(/^PISTA\s*/i, 'Pista ') : '', url: `https://www.youtube.com/watch?v=${v.yt}`, original: v.titulo };
    if (achou) {
      (atual.porTorneio[achou.t.id] = atual.porTorneio[achou.t.id] || []).push(item);
      novos++;
    } else {
      atual.semTorneio.unshift(item);
      sem++;
    }
  }
  atual.semTorneio = atual.semTorneio.slice(0, 30);
  for (const k of Object.keys(atual.porTorneio)) atual.porTorneio[k].sort((a, b) => a.dia.localeCompare(b.dia) || a.titulo.localeCompare(b.titulo));
  atual.atualizadoEm = new Date().toISOString();
  await fs.writeFile(arq, JSON.stringify(atual, null, 1) + '\n');
  console.log(`Transmissões: ${novos} associadas a torneios, ${sem} sem torneio correspondente.`);
}
