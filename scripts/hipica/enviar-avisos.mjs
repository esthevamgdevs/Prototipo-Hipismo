// Salta · passo de avisos do GitHub Actions
// Roda DEPOIS que a coleta já salvou os dados no repositório. Compara o índice de antes da coleta
// (foto guardada pelo coletar.mjs fora do repositório) com o índice atual e envia os avisos.
// Uma falha ou demora aqui nunca afeta os dados: no pior caso, os avisos desta rodada não saem.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enviarAvisos } from './avisos.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.resolve(DIR, process.env.SAIDA || '../../data/hipica');
const ARQ_ANTERIOR = process.env.AVISOS_ANTERIOR || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'salta-index-anterior.json');

const ler = async arq => JSON.parse(await fs.readFile(arq, 'utf8'));

async function main() {
  let anterior, atual;
  try { anterior = await ler(ARQ_ANTERIOR); }
  catch { console.log('Avisos: sem a foto do índice anterior (a coleta não rodou nesta execução). Nada a enviar.'); return; }
  try { atual = (await ler(path.join(SAIDA, 'index.json'))).torneios || []; }
  catch (e) { console.warn('Avisos: não deu para ler o índice atual,', e.message); return; }
  const r = await enviarAvisos({ saida: SAIDA, anterior, atual });
  console.log('Avisos: concluído.', JSON.stringify(r));
}

main().catch(e => { console.error('Avisos: erro inesperado,', e.message); process.exitCode = 1; });
