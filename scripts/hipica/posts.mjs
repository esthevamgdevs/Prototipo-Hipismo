// scripts/hipica/posts.mjs
// Gera rascunhos de post quando um cavalo vendido pela Opportunity pontua
// (coloca-se entre 1º e 3º lugar), a partir de data/hipica/opp.json.
// Roda só na coleta completa, logo depois de node coletar.mjs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.resolve(DIR, process.env.SAIDA || '../../data/hipica');

const OPP_PATH = path.join(SAIDA, 'opp.json');
const ESTADO_PATH = path.join(SAIDA, 'posts-estado.json');
const PENDENTES_PATH = path.join(SAIDA, 'posts-pendentes.json');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_DESTINO = process.env.POSTS_EMAIL_DESTINO; // e-mail de quem revisa

async function lerJson(caminho, padrao) {
  try {
    return JSON.parse(await fs.readFile(caminho, 'utf-8'));
  } catch {
    return padrao;
  }
}

function extrairPodios(opp) {
  const PODIO = [1, 2, 3];
  return (opp.participacoes ?? [])
    .filter((p) => p.s == null && PODIO.includes(p.p)) // s != null = Desistente/Eliminado
    .map((p) => {
      const cavalo = (opp.cavalos ?? []).find((c) => c.k === p.k);
      return {
        chave: `${p.pid}-${p.k}`,
        cavalo: p.h,
        cavaleiro: p.c,
        colocacao: p.p,
        totalInscritos: p.n,
        prova: p.pn,
        altura: p.a,
        torneio: p.t,
        torneioId: p.ti,
        data: p.d,
        leilao: cavalo?.leilao ?? null,
        ano: cavalo?.ano ?? null,
      };
    });
}

async function gerarLegendas(evento) {
  const prompt =
    `Escreva duas legendas curtas em português para divulgar que o cavalo ` +
    `"${evento.cavalo}" (vendido no ${evento.leilao ?? 'leilão da Opportunity'}` +
    `${evento.ano ? `, ${evento.ano}` : ''}), montado por ${evento.cavaleiro}, ` +
    `ficou em ${evento.colocacao}º lugar na prova ${evento.prova} (${evento.altura}m) ` +
    `do torneio "${evento.torneio}". ` +
    `Responda só em JSON, sem texto fora do JSON: {"instagram": "...", "whatsapp": "..."}. ` +
    `Tom: empolgado, direto, sem emoji em excesso.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await resp.json();
  const texto = data.content?.find((b) => b.type === 'text')?.text ?? '{}';
  try {
    return JSON.parse(texto.replace(/```json|```/g, '').trim());
  } catch {
    return { instagram: texto, whatsapp: texto };
  }
}

async function enviarEmail(pendentes) {
  if (!RESEND_API_KEY || !EMAIL_DESTINO || pendentes.length === 0) return;

  const corpo = pendentes
    .map(
      (p) =>
        `• ${p.cavalo} — ${p.colocacao}º lugar em "${p.torneio}" (prova ${p.prova})\n` +
        `Instagram: ${p.legendas.instagram}\n` +
        `WhatsApp: ${p.legendas.whatsapp}\n`
    )
    .join('\n---\n');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'salta@seu-dominio.com.br', // precisa de um domínio verificado no Resend
      to: EMAIL_DESTINO,
      subject: `Salta — ${pendentes.length} post(s) pronto(s) pra revisar`,
      text: corpo,
    }),
  });
}

async function main() {
  const opp = await lerJson(OPP_PATH, { cavalos: [], participacoes: [] });
  const estado = await lerJson(ESTADO_PATH, { processados: [] });
  const pendentesAtual = await lerJson(PENDENTES_PATH, []);

  const podios = extrairPodios(opp);
  const novos = podios.filter((e) => !estado.processados.includes(e.chave));

  const novosComLegenda = [];
  for (const evento of novos) {
    const legendas = await gerarLegendas(evento);
    novosComLegenda.push({
      ...evento,
      legendas,
      status: 'pendente',
      geradoEm: new Date().toISOString(),
    });
  }

  if (novosComLegenda.length > 0) {
    await fs.writeFile(
      PENDENTES_PATH,
      JSON.stringify([...pendentesAtual, ...novosComLegenda], null, 2)
    );
    await fs.writeFile(
      ESTADO_PATH,
      JSON.stringify({ processados: [...estado.processados, ...novos.map((e) => e.chave)] }, null, 2)
    );
    await enviarEmail(novosComLegenda);
    console.log(`${novosComLegenda.length} rascunho(s) de post gerado(s).`);
  } else {
    console.log('Nenhum pódio novo de vendido pela Opportunity.');
  }
}

main().catch((err) => {
  console.error('Erro em posts.mjs:', err);
  process.exit(1);
});
