// Estatísticas do Pista: ranking da temporada e perfis de cavaleiros e cavalos,
// calculados a partir dos resultados já coletados (nada é buscado na FPH aqui).
//
// Privacidade: em provas de categorias infantis o sobrenome do atleta é abreviado,
// como fazem outros apps de hipismo, porque essas provas são disputadas por crianças.
import fs from 'node:fs/promises';
import path from 'node:path';

// Códigos de categoria da FPH que correspondem a crianças (mini mirim, pré-mirim, mirim...)
export const CAT_INFANTIL = /\b(MMR|PMR|MRA|MRB|MIRIM|PR[ÉE][- ]?MIRIM|MINI[- ]?MIRIM|INFANTIL|KIDS?)\b/i;
const SIGLAS = [
  [/PAULISTA/i, 'FPH'], [/PARANAENSE/i, 'FPrH'], [/BRAS[ÍI]LIA/i, 'FHBr'],
  [/RIO DE JANEIRO/i, 'FEERJ'], [/MINAS/i, 'FHMG'], [/RIO GRANDE DO SUL|GA[ÚU]CHA/i, 'FGH'],
  [/SANTA CATARINA|CATARINENSE/i, 'FCH'], [/GOI[ÁA]S|GOIANA/i, 'FHGO'], [/BAHIA|BAIANA/i, 'FBH'],
  [/PERNAMBUC/i, 'FPeH'], [/CEAR[ÁA]/i, 'FCeH'], [/MATO GROSSO DO SUL/i, 'FHMS'],
  [/MATO GROSSO/i, 'FHMT'], [/ESP[ÍI]RITO SANTO/i, 'FHES'], [/CONFEDERA/i, 'CBH'],
];
const sigla = f => { for (const [re, s] of SIGLAS) if (re.test(f || '')) return s; return null; };

// "MARIA EDUARDA PARMA RODRIGUES" -> "Maria Eduarda P. R." em provas infantis
export function abreviar(nome) {
  const partes = nome.trim().split(/\s+/);
  if (partes.length <= 2) return partes.map(p => p[0] + p.slice(1).toLowerCase()).join(' ');
  return partes.slice(0, 2).map(p => p[0] + p.slice(1).toLowerCase()).join(' ') + ' ' +
    partes.slice(2).map(p => p[0] + '.').join(' ');
}

const chave = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export async function gerarEstatisticas(saida, torneios, anoDe) {
  const cavaleiros = new Map(), cavalos = new Map(), clubes = new Map();
  // Cavalos vendidos pela Opportunity (lista mantida à mão em data/hipica/vendidos.json)
  let vendidos = null;
  try { vendidos = new Map((JSON.parse(await fs.readFile(path.join(saida, 'vendidos.json'), 'utf8')).cavalos || []).map(x => [x.k, x])); } catch {}
  const hojeBR = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const participacoes = [], proximas = [];
  const resumoTorneio = new Map();
  const fichas = new Map(); // chave do cavalo -> { pai, mae, nasc, raca, criador }
  const guardaFicha = o => {
    if (!o || !(o.pai || o.mae || o.nasc || o.criador)) return;
    const k = chave(o.h), atual = fichas.get(k) || {};
    for (const c of ['pai', 'mae', 'nasc', 'raca', 'criador']) {
      if (!o[c] || atual[c]) continue;
      if (c === 'pai' || c === 'mae') { atual[c] = String(o[c]).replace(/[.\s]+$/, '').trim(); continue; }
      if (c === 'criador' && (o[c].trim().length <= 4 || /^[A-Z]{1,4}(\s+-\s+.*)?$|BRASILEIRO DE HIPISMO/i.test(o[c].trim()))) continue; // raça, não criador
      atual[c] = o[c];
    }
    fichas.set(k, atual);
  };
  const novo = (nome) => ({ nome, largadas: 0, vitorias: 0, podios: 0, zerados: 0, parceiros: new Map(), hist: [], fed: null, infantil: 0 });
  const pega = (mapa, nome) => { const k = chave(nome); if (!mapa.has(k)) mapa.set(k, novo(nome)); return mapa.get(k); };

  for (const t of torneios) {
    if (!t.fim || t.fim < anoDe) continue;
    let dados;
    try { dados = JSON.parse(await fs.readFile(path.join(saida, 't', `${t.id}.json`), 'utf8')); } catch { continue; }
    const provas = new Map(t.provas.map(p => [String(p.id), p]));
    for (const ordem of Object.values(dados.ordem || {})) for (const o of ordem) guardaFicha(o);
    if (vendidos) {
      // inscritos de provas futuras que ainda não têm ordem de entrada
      for (const [numero, lista] of Object.entries(dados.inscritos || {})) {
        const p = t.provas.find(x => String(x.numero).toUpperCase() === numero);
        if (!p || p.res || !p.dia || p.dia < hojeBR || (p.id && dados.ordem && dados.ordem[p.id])) continue;
        for (const o of lista) {
          if (!vendidos.has(chave(o.h))) continue;
          proximas.push({ d: p.dia, hora: p.hora || null, ti: t.id, t: t.nome, pid: p.id ? Number(p.id) : null, pn: p.numero, a: p.altura ?? null,
            k: chave(o.h), h: o.h, c: o.c, o: null, n: lista.length, inscrito: true });
        }
      }
      for (const [pid, ordem] of Object.entries(dados.ordem || {})) {
        const p = provas.get(pid);
        if (!p || p.res || !p.dia || p.dia < hojeBR) continue;
        for (const o of ordem) {
          if (!vendidos.has(chave(o.h))) continue;
          proximas.push({ d: p.dia, hora: p.hora || null, ti: t.id, t: t.nome, pid: Number(pid), pn: p.numero, a: p.altura ?? null,
            k: chave(o.h), h: o.h, c: o.c, o: o.o, n: ordem.length });
        }
      }
    }
    const rt = { provas: 0, largadas: 0, conjuntos: new Set(), percursos: 0, zerados: 0, alturas: [], vitCav: new Map(), vitCavalo: new Map(), maior: null, opp: { l: 0, v: 0 } };
    resumoTorneio.set(t.id, rt);
    for (const [pid, linhas] of Object.entries(dados.provas || {})) {
      const p = provas.get(pid) || {};
      const infantil = CAT_INFANTIL.test(`${p.nome || ''} ${p.desc || ''}`);
      const total = linhas.length;
      if (total) {
        rt.provas++;
        if (p.altura) rt.alturas.push(p.altura);
        const venc = linhas.find(l => l.p === 1);
        if (venc && p.altura && (!rt.maior || p.altura > rt.maior.a || (p.altura === rt.maior.a && (p.dia || '') > (rt.maior.d || ''))))
          rt.maior = { a: p.altura, d: p.dia, pn: p.numero, c: venc.c, h: venc.h, empate: linhas.filter(l => l.p === 1).length };
      }
      for (const l of linhas) {
        const zerou = !l.s && l.r && l.r[0] && l.r[0][0] === 0;
        const fed = l.f != null ? dados.fed[l.f] : null;
        const item = { d: p.dia || t.fim, t: t.nome, ti: t.id, pn: p.numero, a: p.altura, p: l.p, n: total, r: l.r || null, s: l.s || null };

        rt.largadas++; rt.conjuntos.add(`${chave(l.c)}|${chave(l.h)}`);
        if (l.r && l.r[0]) { rt.percursos++; if (zerou) rt.zerados++; }
        if (l.p === 1) { rt.vitCav.set(l.c, (rt.vitCav.get(l.c) || 0) + 1); rt.vitCavalo.set(chave(l.h), (rt.vitCavalo.get(chave(l.h)) || 0) + 1); }
        if (vendidos && vendidos.has(chave(l.h))) { rt.opp.l++; if (l.p === 1) rt.opp.v++; }
        const c = pega(cavaleiros, l.cavaleiro || l.c);
        c.largadas++; if (l.p === 1) c.vitorias++; if (l.p <= 3) c.podios++; if (zerou) c.zerados++;
        if (infantil) c.infantil++;
        if (fed && !c.fed) c.fed = fed;
        c.parceiros.set(l.h, (c.parceiros.get(l.h) || 0) + 1);
        c.hist.push({ ...item, h: l.h });

        if (vendidos && vendidos.has(chave(l.h))) {
          participacoes.push({ d: p.dia || t.fim, ti: t.id, t: t.nome, pid: Number(pid), pn: p.numero, a: p.altura ?? null,
            k: chave(l.h), h: l.h, c: infantil ? abreviar(l.c) : l.c, p: l.p, n: total, r: l.r || null, s: l.s || null, inf: infantil || undefined });
        }
        const h = pega(cavalos, l.h);
        h.largadas++; if (l.p === 1) h.vitorias++; if (l.p <= 3) h.podios++; if (zerou) h.zerados++;
        if (infantil) h.infantil++;
        h.parceiros.set(l.c, (h.parceiros.get(l.c) || 0) + 1);
        h.hist.push({ ...item, c: l.c });

        if (fed) {
          if (!clubes.has(fed)) clubes.set(fed, { nome: fed, largadas: 0, vitorias: 0, podios: 0 });
          const cl = clubes.get(fed);
          cl.largadas++; if (l.p === 1) cl.vitorias++; if (l.p <= 3) cl.podios++;
        }
      }
    }
  }

  // Nome exibido: abreviado quando a maioria das largadas foi em prova infantil
  const arruma = (x, tipoPessoa) => {
    const proteger = tipoPessoa && x.infantil > x.largadas / 2;
    const nome = proteger ? abreviar(x.nome) : x.nome;
    const hist = x.hist.sort((a, b) => (b.d || '').localeCompare(a.d || '')).slice(0, 8);
    const parceiros = [...x.parceiros.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, q]) => ({ n, q }));
    const porAltura = {};
    for (const it of x.hist) {
      if (it.a == null) continue;
      const k = it.a.toFixed(2);
      porAltura[k] = porAltura[k] || [0, 0];
      porAltura[k][0]++; if (it.p === 1) porAltura[k][1]++;
    }
    return {
      nome, prot: proteger || undefined, fed: x.fed ? (sigla(x.fed) || x.fed) : undefined,
      l: x.largadas, v: x.vitorias, po: x.podios, z: x.zerados,
      alt: porAltura, par: parceiros, hist,
    };
  };

  // Perfis divididos por letra inicial: o app baixa só o pedaço que precisa
  const fatia = k => { const c = k[0]; return /[A-Z]/.test(c) ? c : (/[0-9]/.test(c) ? '0' : '_'); };
  const perfis = { cavaleiros: {}, cavalos: {} };
  const busca = [];
  for (const [tipo, mapa, pessoa] of [['cavaleiros', cavaleiros, true], ['cavalos', cavalos, false]]) {
    for (const [k, x] of mapa) {
      const perfil = arruma(x, pessoa);
      if (!pessoa && fichas.has(k)) perfil.ficha = fichas.get(k);
      const f = fatia(k);
      (perfis[tipo][f] = perfis[tipo][f] || {})[k] = perfil;
      busca.push([tipo === 'cavaleiros' ? 'c' : 'h', k, perfil.nome, perfil.l, perfil.v]);
    }
  }
  const dirPerfis = path.join(saida, 'perfis');
  await fs.rm(dirPerfis, { recursive: true, force: true });
  for (const [tipo, fatias] of Object.entries(perfis)) {
    for (const [f, conteudo] of Object.entries(fatias)) {
      const arq = path.join(dirPerfis, tipo, `${f}.json`);
      await fs.mkdir(path.dirname(arq), { recursive: true });
      await fs.writeFile(arq, JSON.stringify(conteudo) + '\n');
    }
  }
  busca.sort((a, b) => b[3] - a[3]);
  await fs.writeFile(path.join(saida, 'busca.json'), JSON.stringify(busca) + '\n');

  const topo = (mapa, tipoPessoa) => [...mapa.entries()]
    .map(([k, x]) => ({ k, ...arruma(x, tipoPessoa) }))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v || b.po - a.po || b.z - a.z)
    .slice(0, 50)
    .map(({ k, nome, fed, l, v, po, z }) => ({ k, nome, fed, l, v, po, z }));

  // Criação: desempenho em pista agrupado por pai (garanhão) e por criador
  // raça escrita por extenso ou só o código (BH, Z, KWPN…) não é criador
  const criadorValido = c => c && String(c).replace(/[^A-Za-z]/g, '').length > 4 && !/^[A-Z]{1,4}(\s+-\s+.*)?$|BRASILEIRO DE HIPISMO/i.test(c.trim());
  const limpaNome = n => String(n || '').replace(/[.\s]+$/, '').trim();
  const base = {}, pais = new Map(), criadores = new Map();
  let comFicha = 0;
  for (const [k, h] of cavalos) {
    const perfil = arruma(h, false);
    const alts = Object.keys(perfil.alt || {}).map(Number);
    const max = alts.length ? Math.max(...alts) : null;
    const f = fichas.get(k) || {};
    const cr = criadorValido(f.criador) ? f.criador : null;
    if (!f.pai && !cr) continue;              // estas telas só mostram cavalos com ficha
    comFicha++;
    base[k] = [perfil.nome, perfil.l, perfil.v, perfil.po, max, limpaNome(f.pai), limpaNome(f.mae), cr ? chave(cr) : ''];
    const somar = (mapa, chaveG, nome) => {
      const g = mapa.get(chaveG) || { k: chaveG, nome, cavalos: [], l: 0, v: 0, po: 0, max: null };
      g.cavalos.push(k); g.l += perfil.l; g.v += perfil.v; g.po += perfil.po;
      if (max && (!g.max || max > g.max)) g.max = max;
      mapa.set(chaveG, g);
    };
    if (f.pai) somar(pais, chave(f.pai), limpaNome(f.pai));
    if (cr) somar(criadores, chave(cr), limpaNome(cr));
  }
  const ordenar = l => l.sort((a, b) => b.v - a.v || b.po - a.po || b.cavalos.length - a.cavalos.length || b.l - a.l);
  const listaPais = ordenar([...pais.values()]).map(g => ({ ...g, vendido: vendidos && vendidos.has(g.k) ? vendidos.get(g.k).leilao : undefined }));
  const listaCriadores = ordenar([...criadores.values()]);
  await fs.writeFile(path.join(saida, 'criacao.json'), JSON.stringify({ atualizadoEm: new Date().toISOString(),
    cobertura: { comFicha, total: cavalos.size }, pais: listaPais, criadores: listaCriadores, cavalos: base }) + '\n');

  // Resumo de cada torneio com resultados, montado só com fatos dos dados
  const resumos = {};
  for (const t of torneios) {
    const rt = resumoTorneio.get(t.id);
    if (!rt || !rt.provas) continue;
    const topCav = [...rt.vitCav.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, v]) => v >= 2);
    const vitCriador = new Map();
    for (const [hk, v] of rt.vitCavalo) {
      const cr = (fichas.get(hk) || {}).criador;
      if (criadorValido(cr)) vitCriador.set(cr, (vitCriador.get(cr) || 0) + v);
    }
    const topCriador = [...vitCriador.entries()].sort((a, b) => b[1] - a[1])[0];
    resumos[t.id] = {
      provas: rt.provas, largadas: rt.largadas, conjuntos: rt.conjuntos.size,
      altMin: rt.alturas.length ? Math.min(...rt.alturas) : null, altMax: rt.alturas.length ? Math.max(...rt.alturas) : null,
      zeroPct: rt.percursos ? Math.round(rt.zerados / rt.percursos * 100) : null,
      topCav: topCav.map(([nome, v]) => ({ nome, v })),
      maior: rt.maior, opp: rt.opp.l ? rt.opp : null,
      topCriador: topCriador && topCriador[1] >= 2 ? { nome: topCriador[0], v: topCriador[1] } : null,
      parcial: !(t.fim && t.fim < hojeBR),
    };
  }
  await fs.writeFile(path.join(saida, 'resumos.json'), JSON.stringify(resumos) + '\n');

  // Filiação de todos os cavalos da temporada, num arquivo compacto: [pai, mãe, avô materno]
  // (o avô materno sai da ficha da mãe, quando ela também aparece nos dados)
  const filiacao = {};
  for (const [k, f] of fichas) {
    if (!f.pai && !f.mae) continue;
    const avo = f.mae ? (fichas.get(chave(f.mae)) || {}).pai : null;
    filiacao[k] = avo ? [f.pai || '', f.mae || '', avo] : [f.pai || '', f.mae || ''];
  }
  await fs.writeFile(path.join(saida, 'filiacao.json'), JSON.stringify(filiacao) + '\n');

  // Visão Opportunity: vai para um arquivo próprio, que o app só baixa quando a aba é aberta
  let opp = null;
  if (vendidos) {
    const lista = [...vendidos.values()].map(x => {
      const h = cavalos.get(x.k);
      if (!h) return null;
      const perfil = arruma(h, false);
      const alts = Object.keys(perfil.alt || {}).map(Number);
      return { k: x.k, nome: perfil.nome, leilao: x.leilao, ano: x.ano, l: perfil.l, v: perfil.v, po: perfil.po, z: perfil.z, max: alts.length ? Math.max(...alts) : null };
    }).filter(Boolean).sort((a, b) => b.v - a.v || b.po - a.po || b.l - a.l);
    const totais = { cavalos: lista.length, largadas: lista.reduce((s, x) => s + x.l, 0), vitorias: lista.reduce((s, x) => s + x.v, 0), podios: lista.reduce((s, x) => s + x.po, 0), proximas: proximas.length };
    participacoes.sort((a, b) => b.d.localeCompare(a.d) || b.ti - a.ti || String(a.pn).localeCompare(String(b.pn)) || a.p - b.p);
    proximas.sort((a, b) => a.d.localeCompare(b.d) || String(a.hora || '').localeCompare(String(b.hora || '')) || (a.o ?? 999) - (b.o ?? 999));
    const filhos = [];
    for (const [k, f] of fichas) {
      const h = cavalos.get(k);
      if (!h) continue;
      for (const lado of ['pai', 'mae']) {
        const v = f[lado] && vendidos.get(chave(f[lado]));
        if (!v) continue;
        const perfil = arruma(h, false);
        const alts = Object.keys(perfil.alt || {}).map(Number);
        filhos.push({ k, nome: perfil.nome, lado, genitor: f[lado], leilao: v.leilao, ano: v.ano, l: perfil.l, v: perfil.v, po: perfil.po, max: alts.length ? Math.max(...alts) : null });
      }
    }
    filhos.sort((a, b) => b.v - a.v || b.po - a.po || b.l - a.l);
    totais.filhos = filhos.length;
    await fs.writeFile(path.join(saida, 'opp.json'), JSON.stringify({ atualizadoEm: new Date().toISOString(), totais, cavalos: lista, participacoes, proximas, filhos }) + '\n');
    opp = { totais };
  }

  const stats = {
    atualizadoEm: new Date().toISOString(),
    opp,
    desde: anoDe,
    totais: {
      torneios: torneios.filter(t => t.fim >= anoDe && t.provas.some(p => p.res)).length,
      cavaleiros: cavaleiros.size, cavalos: cavalos.size,
      percursos: [...cavaleiros.values()].reduce((s, x) => s + x.largadas, 0),
    },
    cavaleiros: topo(cavaleiros, true),
    cavalos: topo(cavalos, false),
    clubes: [...clubes.values()].map(c => ({ ...c, nome: sigla(c.nome) ? c.nome : c.nome, sig: sigla(c.nome) }))
      .sort((a, b) => b.vitorias - a.vitorias).slice(0, 20),
  };

  await fs.writeFile(path.join(saida, 'stats.json'), JSON.stringify(stats) + '\n');
  return stats.totais;
}
