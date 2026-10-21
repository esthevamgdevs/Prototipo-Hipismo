// Índice Salta: nota de cada cavalo em pista e de cada reprodutor, a partir dos resultados públicos.
//
// Ideia: o desempenho do próprio cavalo pesa mais; a família (pai, mãe, irmãos, avô materno e
// descendentes) complementa. Quem tem pouca informação é puxado para a média, e a nota vem sempre
// acompanhada de uma confiança. A herdabilidade do desempenho em salto é baixa, então a família
// indica tendência, nunca garantia.
//
// Todos os números ajustáveis ficam em PARAMETROS, e vão junto no arquivo publicado, para que o app
// mostre exatamente o método usado em "Como calculamos".

export const PARAMETROS = {
  versao: 'v1 · 20/10/2026',
  // nota de uma largada: 60% pela colocação na prova e 40% por zerar a primeira fase
  pesoColocacao: 0.6, pesoZero: 0.4,
  // fator de altura: 0,50 a 1,00m e 1,00 a 1,40m (mínimo 0,25, máximo 1,40)
  alturaBase: 1.0, alturaInclinacao: 1.25, alturaMin: 0.25, alturaMax: 1.4,
  // desconto do cavaleiro: metade da diferença entre a força dele e a média
  descontoCavaleiro: 0.5, virtuaisCavaleiro: 10,
  // largadas ou parentes "virtuais" na média, para não exagerar quem tem pouca informação
  virtuais: { proprio: 8, pai: 5, mae: 3, avo: 5, desc: 4, garanhao: 5, matriz: 3 },
  // pesos do índice dos cavalos em pista; o que falta entra com o valor neutro
  pesos: { proprio: 0.60, pai: 0.20, mae: 0.12, avo: 0.03, desc: 0.05 },
  neutro: 50,
  // confiança: quanto de cada fonte conta como "completo" e o peso de cada uma
  confianca: { proprio: [0.50, 20], pai: [0.25, 15], mae: [0.15, 3], desc: [0.10, 5] },
  confiancaAlta: 0.60, confiancaMedia: 0.35,
  confiancaReprodutor: { garanhao: [15, 5], matriz: [4, 2] }, // filhos em pista para alta e média
  // faixas de nota pelo percentil
  faixas: [[98, 'AAA'], [93, 'AA+'], [85, 'AA'], [72, 'A+'], [60, 'A'], [45, 'BB+'], [30, 'BB'], [15, 'B'], [0, 'C']],
};

const media = v => v.reduce((s, x) => s + x, 0) / v.length;
const notaDe = (pct, P) => (P.faixas.find(([min]) => pct >= min) || [0, 'C'])[1];
// percentil de 0 a 100 de cada valor dentro do seu grupo
function percentis(mapa) {
  const ord = [...mapa.entries()].sort((a, b) => a[1] - b[1]);
  const out = new Map(), n = ord.length;
  ord.forEach(([k], i) => out.set(k, n > 1 ? Math.round(1000 * i / (n - 1)) / 10 : 50));
  return out;
}

// largadas: [{ h, nome, c, p, n, a, z, s }]   h e c já normalizados (chave)
// filiacao: { chaveDoCavalo: [pai, mãe, avô materno] }   (nomes como na FPH)
export function calcularIndice(largadas, filiacao, chave, P = PARAMETROS) {
  // 1. nota de cada largada
  const L = largadas.filter(x => x.n >= 2).map(x => {
    const colocacao = x.s ? 0 : Math.max(0, 1 - (x.p - 1) / (x.n - 1));
    const fator = Math.min(P.alturaMax, Math.max(P.alturaMin, 0.5 + ((x.a || P.alturaBase) - P.alturaBase) * P.alturaInclinacao));
    return { ...x, v: (P.pesoColocacao * colocacao + P.pesoZero * (x.z && !x.s ? 1 : 0)) * fator };
  });
  if (!L.length) return null;
  const G = media(L.map(x => x.v));
  // 2. força de cada cavaleiro e o desconto
  const porCav = new Map();
  for (const x of L) (porCav.get(x.c) || porCav.set(x.c, []).get(x.c)).push(x.v);
  const forca = new Map([...porCav].map(([c, v]) => [c, (v.reduce((s, y) => s + y, 0) + P.virtuaisCavaleiro * G) / (v.length + P.virtuaisCavaleiro)]));
  // 3. desempenho próprio de cada cavalo
  const porCavalo = new Map();
  for (const x of L) {
    const aj = x.v - P.descontoCavaleiro * (forca.get(x.c) - G);
    const h = porCavalo.get(x.h) || porCavalo.set(x.h, { nome: x.nome, aj: [], vit: 0, pod: 0, zero: 0, alt: 0 }).get(x.h);
    h.aj.push(aj); if (!x.s && x.p === 1) h.vit++; if (!x.s && x.p <= 3) h.pod++; if (x.z && !x.s) h.zero++; h.alt = Math.max(h.alt, x.a || 0);
  }
  const prop = new Map();
  for (const [k, h] of porCavalo) {
    const n = h.aj.length, m = media(h.aj);
    prop.set(k, { n, bruto: (n * m + P.virtuais.proprio * G) / (n + P.virtuais.proprio) });
  }
  const GP = media([...prop.values()].map(x => x.bruto));
  // 4. família, sempre sem contar o próprio cavalo
  const pai = new Map(), mae = new Map(), avo = new Map();
  for (const [k, f] of Object.entries(filiacao || {})) {
    if (f[0]) pai.set(k, chave(f[0])); if (f[1]) mae.set(k, chave(f[1])); if (f[2]) avo.set(k, chave(f[2]));
  }
  const grupos = (mapa) => { const g = new Map(); for (const k of prop.keys()) if (mapa.has(k)) (g.get(mapa.get(k)) || g.set(mapa.get(k), []).get(mapa.get(k))).push(k); return g; };
  const filhosP = grupos(pai), filhosM = grupos(mae), netosA = grupos(avo);
  const encolhe = (vals, k) => (vals.reduce((s, x) => s + x, 0) + k * GP) / (vals.length + k);
  const comp = { proprio: new Map(), pai: new Map(), mae: new Map(), avo: new Map(), desc: new Map() };
  const cont = { pai: new Map(), mae: new Map(), avo: new Map(), desc: new Map() };
  for (const [h, pr] of prop) {
    comp.proprio.set(h, pr.bruto);
    if (pai.has(h)) {
      const v = (filhosP.get(pai.get(h)) || []).filter(o => o !== h).map(o => prop.get(o).bruto);
      if (v.length) { comp.pai.set(h, encolhe(v, P.virtuais.pai)); cont.pai.set(h, v.length); }
    }
    if (mae.has(h)) {
      const v = (filhosM.get(mae.get(h)) || []).filter(o => o !== h).map(o => prop.get(o).bruto);
      if (prop.has(mae.get(h))) v.push(prop.get(mae.get(h)).bruto); // a própria mãe, se competiu
      if (v.length) { comp.mae.set(h, encolhe(v, P.virtuais.mae)); cont.mae.set(h, v.length); }
    }
    if (avo.has(h)) {
      const v = (netosA.get(avo.get(h)) || []).filter(o => o !== h && mae.get(o) !== mae.get(h)).map(o => prop.get(o).bruto);
      if (v.length) { comp.avo.set(h, encolhe(v, P.virtuais.avo)); cont.avo.set(h, v.length); }
    }
    const d = [...(filhosP.get(h) || []), ...(filhosM.get(h) || [])].map(o => prop.get(o).bruto);
    if (d.length) { comp.desc.set(h, encolhe(d, P.virtuais.desc)); cont.desc.set(h, d.length); }
  }
  const esc = Object.fromEntries(Object.entries(comp).map(([k, m]) => [k, percentis(m)]));
  // 5. índice, confiança e nota dos cavalos em pista
  const indice = new Map(), confianca = new Map();
  for (const h of prop.keys()) {
    let s = 0;
    for (const [k, w] of Object.entries(P.pesos)) s += w * (esc[k].has(h) ? esc[k].get(h) : P.neutro);
    indice.set(h, Math.round(s * 10) / 10);
    const n = { proprio: prop.get(h).n, pai: cont.pai.get(h) || 0, mae: cont.mae.get(h) || 0, desc: cont.desc.get(h) || 0 };
    let c = 0; for (const [k, [w, cheio]] of Object.entries(P.confianca)) c += w * Math.min(1, n[k] / cheio);
    confianca.set(h, c >= P.confiancaAlta ? 'a' : c >= P.confiancaMedia ? 'm' : 'b');
  }
  const pctIndice = percentis(indice);
  const cavalos = {};
  for (const h of prop.keys()) {
    const comps = ['proprio', 'pai', 'mae', 'avo', 'desc'].map(k => esc[k].has(h) ? Math.round(esc[k].get(h)) : null);
    cavalos[h] = [indice.get(h), notaDe(pctIndice.get(h), P), confianca.get(h), ...comps,
      prop.get(h).n, cont.pai.get(h) || 0, cont.mae.get(h) || 0, cont.avo.get(h) || 0, cont.desc.get(h) || 0];
  }
  // 6. reprodutores, pelos filhos em pista
  const reprodutores = (mapa, k, [alta, med]) => {
    const bruto = new Map(), info = new Map();
    for (const [r, fs] of mapa) {
      const v = fs.map(o => prop.get(o).bruto);
      bruto.set(r, encolhe(v, k));
      info.set(r, { n: fs.length, vit: fs.reduce((s, o) => s + porCavalo.get(o).vit, 0), larg: fs.reduce((s, o) => s + prop.get(o).n, 0) });
    }
    const pct = percentis(bruto), out = {};
    for (const [r, i] of info) out[r] = [pct.get(r), notaDe(pct.get(r), P), i.n >= alta ? 'a' : i.n >= med ? 'm' : 'b', i.n, i.larg, i.vit];
    return out;
  };
  const garanhoes = reprodutores(filhosP, P.virtuais.garanhao, P.confiancaReprodutor.garanhao);
  const matrizes = reprodutores(filhosM, P.virtuais.matriz, P.confiancaReprodutor.matriz);
  // 7. ranking pronto para o app: só confiança média ou alta
  const ranking = [...prop.keys()].filter(h => confianca.get(h) !== 'b').sort((a, b) => indice.get(b) - indice.get(a)).slice(0, 100)
    .map(h => [h, porCavalo.get(h).nome]);
  return {
    versao: P.versao, atualizadoEm: new Date().toISOString(), parametros: P,
    totais: { largadas: L.length, cavalos: prop.size, cavaleiros: forca.size },
    campos: ['indice', 'nota', 'confianca', 'proprio', 'pai', 'mae', 'avo', 'desc', 'largadas', 'irmaosPaternos', 'maeEIrmaos', 'netosDoAvo', 'descendentes'],
    cavalos, garanhoes, matrizes, ranking,
  };
}
