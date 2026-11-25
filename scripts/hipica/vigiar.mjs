// Salta · vigia da coleta
// Último passo do GitHub Actions. Roda SEMPRE, até quando a coleta quebra. Lê o boletim que o
// coletar.mjs deixa fora do repositório e confere se algo saiu do normal.
// Cada tipo de problema tem um aviso (issue) no GitHub:
//   - aparece   → abre o aviso (você é mencionado e recebe a notificação);
//   - continua  → só atualiza o "visto pela última vez", em silêncio;
//   - some      → depois de 30 minutos sem acontecer, comenta "voltou ao normal" e fecha.
// O repositório é público, então o aviso também é: só números e endereços da FPH, nunca nomes.
// Não usa nenhum pacote: roda mesmo se a instalação das dependências tiver falhado.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ARQ_BOLETIM = process.env.BOLETIM || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'salta-boletim.json');
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const REPO = process.env.GITHUB_REPOSITORY || '';
const TOKEN = process.env.GITHUB_TOKEN || '';
const DONO = process.env.GITHUB_REPOSITORY_OWNER || REPO.split('/')[0];
const EXECUCAO = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
const RESULTADO_COLETA = process.env.RESULTADO_COLETA || '';  // success, failure, cancelled ou skipped
const RESULTADO_SALVAR = process.env.RESULTADO_SALVAR || '';

// Os números combinados
const QUEDA_MAXIMA = 0.10;        // queda de mais de 10% em torneios ou percursos de uma rodada para outra
const FPH_RODADAS = 3;            // FPH sem responder em 3 rodadas seguidas
const FECHAR_DEPOIS_MIN = 30;     // fecha o aviso depois de 30 minutos sem o problema
const ETIQUETA = 'alerta-coletor';

const quando = d => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d);
const pct = (antes, depois) => `${Math.round((1 - depois / antes) * 100)}%`;
const caiu = (antes, depois) => Number.isFinite(antes) && Number.isFinite(depois) && antes > 0 && depois < antes * (1 - QUEDA_MAXIMA);

// ---------- 1) O que está errado nesta rodada ----------
function diagnosticar(b) {
  const problemas = new Map();   // chave → { titulo, texto, detalhes }
  const avaliados = new Set();   // o que esta rodada consegue confirmar que está normal

  if (b?.robotsBloqueou) {
    problemas.set('robots', {
      titulo: 'Coletor: o robots.txt da FPH bloqueou o acesso',
      texto: 'O robots.txt da FPH passou a proibir o acesso às páginas que o Salta lê. A coleta parou na hora, sem ler nada, como manda a regra.',
      detalhes: [],
    });
  }
  if (b?.robotsBloqueou || b?.terminou) avaliados.add('robots');

  avaliados.add('coleta-quebrou');
  if (!b?.robotsBloqueou && (RESULTADO_COLETA !== 'success' || !b?.terminou)) {
    const detalhes = [`Resultado do passo da coleta: ${RESULTADO_COLETA || 'desconhecido'}`];
    if (b?.erro) detalhes.push(`Erro: ${b.erro}`);
    if (!b) detalhes.push('A coleta não chegou a deixar o boletim da rodada.');
    problemas.set('coleta-quebrou', {
      titulo: 'Coletor: a coleta quebrou',
      texto: 'A coleta parou antes do fim (erro, tempo esgotado ou cancelamento). Os dados desta rodada não foram atualizados.',
      detalhes,
    });
  }

  if (['success', 'failure'].includes(RESULTADO_SALVAR)) {
    avaliados.add('dados-nao-salvos');
    if (RESULTADO_SALVAR === 'failure') {
      problemas.set('dados-nao-salvos', {
        titulo: 'Coletor: não deu para salvar os dados',
        texto: 'A coleta terminou, mas o envio dos dados para o repositório falhou nas 3 tentativas. O app continua mostrando os dados antigos.',
        detalhes: [],
      });
    }
  }

  if (b?.terminou) {
    ['sem-torneios', 'queda', 'pagina-nao-reconhecida', 'fph-sem-resposta'].forEach(k => avaliados.add(k));

    if (b.torneiosDepois === 0) {
      problemas.set('sem-torneios', {
        titulo: 'Coletor: a coleta voltou sem nenhum torneio',
        texto: 'A rodada terminou com a lista de torneios vazia. Normalmente é sinal de que a FPH mudou o site.',
        detalhes: [`Torneios antes: ${b.torneiosAntes ?? '?'} · depois: 0`],
      });
    } else {
      const quedas = [];
      if (caiu(b.torneiosAntes, b.torneiosDepois)) quedas.push(`Torneios: de ${b.torneiosAntes} para ${b.torneiosDepois} (queda de ${pct(b.torneiosAntes, b.torneiosDepois)})`);
      if (caiu(b.percursosAntes, b.percursosDepois)) quedas.push(`Percursos: de ${b.percursosAntes} para ${b.percursosDepois} (queda de ${pct(b.percursosAntes, b.percursosDepois)})`);
      if (quedas.length) {
        problemas.set('queda', {
          titulo: 'Coletor: queda brusca nos números da temporada',
          texto: `Os números caíram mais de ${QUEDA_MAXIMA * 100}% de uma rodada para a outra. Pode ser mudança no site da FPH ou erro de leitura.`,
          detalhes: quedas,
        });
      }
    }

    if (b.naoReconhecidos > 0) {
      problemas.set('pagina-nao-reconhecida', {
        titulo: 'Coletor: páginas da FPH que o coletor não reconhece',
        texto: `${b.naoReconhecidos} página(s) foram baixadas, mas o coletor não entendeu o conteúdo. Pode ser mudança no layout da FPH.`,
        detalhes: (b.enderecosNaoReconhecidos || []).slice(0, 10),
      });
    }

    if ((b.fphSemRespostaSeguidas || 0) >= FPH_RODADAS) {
      problemas.set('fph-sem-resposta', {
        titulo: 'Coletor: a FPH não responde',
        texto: `O site da FPH não respondeu a nenhuma página em ${b.fphSemRespostaSeguidas} rodadas seguidas.`,
        detalhes: [`Páginas que falharam nesta rodada: ${b.falhasFPH}`],
      });
    }
  }
  return { problemas, avaliados };
}

// ---------- 2) Conversa com o GitHub ----------
async function gh(metodo, caminho, corpo) {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'salta-vigia',
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const texto = await r.text();
  return { ok: r.ok, status: r.status, dados: texto ? JSON.parse(texto) : null };
}

const marca = chave => `<!-- salta-alerta:${chave} -->`;
const chaveDo = corpo => (String(corpo || '').match(/<!-- salta-alerta:([a-z-]+) -->/) || [])[1];
const desdeDo = corpo => (String(corpo || '').match(/<!-- desde:([0-9TZ:.-]+) -->/) || [])[1];

function corpoDoAviso(chave, p, desde, agora) {
  return [
    marca(chave),
    `<!-- desde:${desde} -->`,
    `@${DONO}, o vigia da coleta encontrou um problema.`,
    '',
    p.texto,
    ...(p.detalhes.length ? ['', ...p.detalhes.map(d => `- ${d}`)] : []),
    '',
    `**Começou em:** ${quando(new Date(desde))}`,
    `**Visto pela última vez:** ${quando(agora)}`,
    ...(EXECUCAO ? [`**Execução:** ${EXECUCAO}`] : []),
    '',
    `_Este aviso foi aberto sozinho e se fecha sozinho quando o problema passar ${FECHAR_DEPOIS_MIN} minutos sem aparecer. O repositório é público: aqui só entram números e endereços da FPH, nunca nomes._`,
  ].join('\n');
}

async function main() {
  let b = null;
  try { b = JSON.parse(await fs.readFile(ARQ_BOLETIM, 'utf8')); }
  catch { console.log('Vigia: a coleta não deixou boletim nesta rodada.'); }

  const { problemas, avaliados } = diagnosticar(b);
  console.log(`Vigia: ${problemas.size ? [...problemas.keys()].join(', ') : 'nenhum problema'} nesta rodada.`);

  if (!TOKEN || !REPO) { console.warn('Vigia: sem GITHUB_TOKEN ou GITHUB_REPOSITORY; os avisos não foram atualizados.'); return; }

  const lista = await gh('GET', `/repos/${REPO}/issues?state=open&labels=${ETIQUETA}&per_page=100`);
  if (!lista.ok) throw new Error(`não deu para listar os avisos (HTTP ${lista.status})`);
  const abertos = new Map();
  for (const i of lista.dados || []) {
    const k = chaveDo(i.body);
    if (k && !i.pull_request) abertos.set(k, i);
  }

  const agora = new Date();
  if (problemas.size && !abertos.size) {
    // a etiqueta precisa existir; se já existe, o GitHub responde 422 e seguimos
    await gh('POST', `/repos/${REPO}/labels`, { name: ETIQUETA, color: 'd93f0b', description: 'Aberto sozinho pelo vigia da coleta' });
  }

  for (const [chave, p] of problemas) {
    const aberto = abertos.get(chave);
    if (aberto) {
      const desde = desdeDo(aberto.body) || aberto.created_at;
      const r = await gh('PATCH', `/repos/${REPO}/issues/${aberto.number}`, { body: corpoDoAviso(chave, p, desde, agora) });
      console.log(`Vigia: "${chave}" continua · aviso #${aberto.number} ${r.ok ? 'atualizado' : `não atualizado (HTTP ${r.status})`}.`);
    } else {
      const r = await gh('POST', `/repos/${REPO}/issues`, { title: p.titulo, body: corpoDoAviso(chave, p, agora.toISOString(), agora), labels: [ETIQUETA] });
      if (!r.ok) throw new Error(`não deu para abrir o aviso "${chave}" (HTTP ${r.status})`);
      console.log(`Vigia: aviso #${r.dados.number} aberto para "${chave}".`);
    }
  }

  for (const [chave, aberto] of abertos) {
    if (problemas.has(chave) || !avaliados.has(chave)) continue;
    const minutos = (agora - new Date(aberto.updated_at)) / 60000;
    if (minutos < FECHAR_DEPOIS_MIN) { console.log(`Vigia: "${chave}" sumiu há pouco; o aviso #${aberto.number} fica aberto mais um tempo.`); continue; }
    await gh('POST', `/repos/${REPO}/issues/${aberto.number}/comments`, { body: `Voltou ao normal. Conferido em ${quando(agora)}${EXECUCAO ? ` · ${EXECUCAO}` : ''}.` });
    const r = await gh('PATCH', `/repos/${REPO}/issues/${aberto.number}`, { state: 'closed', state_reason: 'completed' });
    console.log(`Vigia: "${chave}" voltou ao normal · aviso #${aberto.number} ${r.ok ? 'fechado' : `não fechado (HTTP ${r.status})`}.`);
  }
}

// Se o próprio vigia falhar, a execução fica vermelha no GitHub: é o último recurso para você saber.
main().catch(e => { console.error('Vigia: erro,', e.message); process.exitCode = 1; });
