/*
 * Motor do Gerador de Escalas.
 * Funções puras: recebem a configuração (cfg) e devolvem escala, rótulos e conferência.
 * Usado pela página (window.Motor) e pelos testes automatizados (require).
 *
 * Regras e decisões: juridico/regras/J01–J25 e docs/planejamento §11 (D1–D9).
 */
(function (root) {
  "use strict";

  /* ============ datas ============ */
  const DIA = 864e5;
  const pad = n => String(n).padStart(2, "0");
  const ud = (y, m, d) => new Date(Date.UTC(y, m, d));
  const addDays = (dt, n) => new Date(dt.getTime() + n * DIA);
  const iso = dt => dt.toISOString().slice(0, 10);
  const dowOf = dt => (dt.getUTCDay() + 6) % 7; // 0 = segunda … 6 = domingo
  const ddmm = dt => `${pad(dt.getUTCDate())}/${pad(dt.getUTCMonth() + 1)}`;
  const br = dt => `${ddmm(dt)}/${dt.getUTCFullYear()}`;
  const fromIso = s => { const [y, m, d] = s.split("-").map(Number); return ud(y, m - 1, d); };
  const toMin = t => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return isNaN(h) || isNaN(m) ? null : h * 60 + m; };
  const fmtH = min => { const t = Math.round(min); return `${Math.floor(t / 60)}h${pad(t % 60)}`; };
  const DOW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  /* Marcos da EC 141/2026 */
  const VIG_2F = Date.UTC(2026, 11, 16); // duas folgas e 42 h (art. 10, I; art. 6º, I)
  const VIG_40 = Date.UTC(2027, 11, 16); // 40 h (art. 6º, II)

  /* ============ feriados ============ */
  function pascoa(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return ud(y, mes - 1, dia);
  }
  function feriadosDoAno(y) {
    const L = [["01-01", "Confraternização Universal"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"],
      ["09-07", "Independência do Brasil"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"],
      ["11-15", "Proclamação da República"], ["12-25", "Natal"]];
    if (y >= 2024) L.push(["11-20", "Dia Nacional de Zumbi e da Consciência Negra"]);
    const out = L.map(([md, nome]) => ({ data: `${y}-${md}`, nome, tipo: "nacional", abre: false }));
    out.push({ data: iso(addDays(pascoa(y), -2)), nome: "Sexta-feira da Paixão", tipo: "confirmar", abre: false });
    return out.sort((a, b) => a.data.localeCompare(b.data));
  }
  function feriadosDoMes(y, m) {
    const pref = `${y}-${pad(m + 1)}`;
    return feriadosDoAno(y).filter(f => f.data.startsWith(pref));
  }

  /* ============ regras ============ */
  const fimSemana = ws => addDays(ws, 6).getTime();
  function folgasSemana(cfg, ws) { // J01, J02, D3
    if (cfg.tipo === "5x2") return 2;
    return fimSemana(ws) >= VIG_2F ? 2 : 1;
  }
  const regimeAntigo = ws => fimSemana(ws) < VIG_2F; // J12 (D2): limite de 6 dias seguidos só antes da EC 141
  function limiteSemanal(ws) { // J04 (D7: horas de relógio)
    const f = fimSemana(ws);
    return f >= VIG_40 ? 2400 : f >= VIG_2F ? 2520 : 2640;
  }
  function janelaModelo(cfg) { // J13 (D5)
    if (cfg.domModelo === "atividade") return 7;
    if (cfg.domModelo === "outro") return Math.max(1, Number(cfg.domN) || 1);
    return 3;
  }
  function janelaDomingo(cfg, p) { // J13 + J15 (CLT, art. 386)
    const n = janelaModelo(cfg);
    return p.sexo === "F" ? Math.min(2, n) : n;
  }
  function baseDomingo(cfg, p) {
    const n = janelaModelo(cfg);
    if (p.sexo === "F" && n > 2) return "CLT, art. 386 (revezamento quinzenal)";
    if (cfg.domModelo === "atividade") return "Portaria MTP 671/2021, art. 56, § 2º";
    if (cfg.domModelo === "outro") return "Periodicidade informada (convenção coletiva ou autorização)";
    return "Lei 10.101/2000, art. 6º, parágrafo único";
  }

  /* J09/J10 — jornada pelo relógio (D7, D8); hora reduzida só informativa */
  function jornada(p) {
    const en = toMin(p.entrada), sa = toMin(p.saida);
    if (en == null || sa == null) return null;
    let dur = (sa - en + 1440) % 1440; if (dur === 0) dur = 1440;
    const ii = toMin(p.intIni), fi = toMin(p.intFim);
    let itv = 0;
    if (ii != null && fi != null) itv = (fi - ii + 1440) % 1440;
    const noturno = (ini, len) => { let n = 0; for (let k = 0; k < len; k++) { const mm = (ini + k) % 1440; if (mm >= 1320 || mm < 300) n++; } return n; };
    const not = Math.max(0, noturno(en, dur) - (itv ? noturno(ii, itv) : 0));
    const eff = dur - itv;
    return {
      dur, itv, eff, not,
      notReduzida: not * 60 / 52.5,          // CLT, art. 73, § 1º
      computadas: eff - not + not * 60 / 52.5,
      cruza: en + dur > 1440,
      informouIntervalo: itv > 0,
    };
  }

  /* ============ contexto do mês ============ */
  function contexto(cfg) {
    const y = cfg.ano, m = cfg.mes, E = cfg.equipe.length;
    const first = ud(y, m, 1), last = ud(y, m + 1, 0);
    const start = addDays(first, -dowOf(first)), end = addDays(last, 6 - dowOf(last));
    const pref = `${y}-${pad(m + 1)}`;
    const ferMap = {};
    for (const a of new Set([start.getUTCFullYear(), end.getUTCFullYear()]))
      for (const f of feriadosDoAno(a)) if (!f.data.startsWith(pref)) ferMap[f.data] = { ...f, proj: true };
    for (const f of cfg.feriados || []) ferMap[f.data] = { ...f };

    const days = [];
    for (let d = start, i = 0; d <= end; d = addDays(d, 1), i++) {
      const k = iso(d), dw = dowOf(d), fer = ferMap[k] || null;
      let aberto = !!cfg.dias[dw].aberto;
      if (fer && !fer.abre) aberto = false;
      days.push({ d, k, dw, i, inMonth: d.getUTCMonth() === m, fer, aberto, min: aberto ? Math.max(0, Number(cfg.dias[dw].min) || 0) : 0 });
    }
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      const ws = days[i].d;
      weeks.push({ i0: i, ws, req: folgasSemana(cfg, ws), antigo: regimeAntigo(ws), limite: limiteSemanal(ws) });
    }
    const grupoDe = cfg.equipe.map(p => String(p.grupo || "").trim());
    const gmin = {};
    for (const g of new Set(grupoDe.filter(Boolean))) { const v = Number((cfg.grupoMin || {})[g]) || 0; if (v > 0) gmin[g] = v; }

    // continuidade: dias já definidos no mês anterior (J24)
    const hist = cfg.historico || null;
    const fixed = cfg.equipe.map(p => days.map(x => {
      const h = hist && hist.porPessoa && hist.porPessoa[p.nome];
      return h && Object.prototype.hasOwnProperty.call(h, x.k) ? !!h[x.k] : null;
    }));
    // estado anterior ao horizonte: sequência de domingos trabalhados e de dias seguidos
    const streak0 = new Array(E).fill(0), run0 = new Array(E).fill(0);
    const temHistorico = cfg.equipe.map(p => !!(hist && hist.porPessoa && hist.porPessoa[p.nome]));
    cfg.equipe.forEach((p, e) => {
      if (!temHistorico[e]) return;
      const h = hist.porPessoa[p.nome];
      const antes = Object.keys(h).filter(k => k < iso(start)).sort();
      for (const k of antes) if (dowOf(fromIso(k)) === 6) streak0[e] = h[k] ? 0 : streak0[e] + 1;
      for (let d = addDays(start, -1); ; d = addDays(d, -1)) { const k = iso(d); if (!(k in h) || h[k]) break; run0[e]++; }
    });
    return { cfg, days, weeks, grupoDe, gmin, first, last, start, end, fixed, streak0, run0, temHistorico, E };
  }

  /* ============ números aleatórios com semente ============ */
  function rng32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  /* ============ fluxo de custo mínimo (para a fase 2) ============ */
  class Fluxo {
    constructor() { this.g = []; }
    no() { this.g.push([]); return this.g.length - 1; }
    aresta(u, v, cap, custo) {
      const a = { v, cap, custo, rev: this.g[v].length, orig: cap };
      const b = { v: u, cap: 0, custo: -custo, rev: this.g[u].length, orig: 0 };
      this.g[u].push(a); this.g[v].push(b); return a;
    }
    rodar(s, t, max) {
      let total = 0; const n = this.g.length;
      while (total < max) {
        const dist = new Array(n).fill(Infinity), naFila = new Array(n).fill(false), pv = new Array(n), pe = new Array(n);
        dist[s] = 0; const fila = [s]; naFila[s] = true;
        let passos = 0;
        while (fila.length) {
          if (++passos > n * n + 1000) return total; // trava de segurança
          const u = fila.shift(); naFila[u] = false;
          this.g[u].forEach((a, idx) => {
            if (a.cap > 0 && dist[u] + a.custo < dist[a.v] - 1e-9) {
              dist[a.v] = dist[u] + a.custo; pv[a.v] = u; pe[a.v] = idx;
              if (!naFila[a.v]) { naFila[a.v] = true; fila.push(a.v); }
            }
          });
        }
        if (dist[t] === Infinity) break;
        let f = max - total;
        for (let v = t; v !== s; v = pv[v]) f = Math.min(f, this.g[pv[v]][pe[v]].cap);
        for (let v = t; v !== s; v = pv[v]) { const a = this.g[pv[v]][pe[v]]; a.cap -= f; this.g[v][a.rev].cap += f; }
        total += f;
      }
      return total;
    }
  }

  /* ============ fase 1: folgas de domingo no mês inteiro ============ */
  function* planosDomingo(ctx, rnd, falhas, orcamento) {
    const { cfg, days, E, gmin, grupoDe, fixed } = ctx;
    const S = days.filter(x => x.dw === 6).map(x => x.i);
    const N = cfg.equipe.map(p => janelaDomingo(cfg, p));
    const ff = cfg.equipe.map(p => (p.folgaFixa === "" || p.folgaFixa == null) ? -1 : Number(p.folgaFixa));
    const streak = ctx.streak0.slice();
    const plano = cfg.equipe.map(() => new Array(S.length).fill(false));
    const gruposOk = folga => Object.keys(gmin).every(g => grupoDe.filter((gg, e) => gg === g && !folga.has(e)).length >= gmin[g]);
    let nos = 0;

    function* combos(lista, tam) {
      const n = lista.length;
      if (tam > n) return;
      const idx = [...Array(tam).keys()];
      while (true) {
        yield idx.map(k => lista[k]);
        let k = tam - 1;
        while (k >= 0 && idx[k] === n - tam + k) k--;
        if (k < 0) return;
        idx[k]++;
        for (let j = k + 1; j < tam; j++) idx[j] = idx[j - 1] + 1;
      }
    }

    function* dfs(k) {
      if (++nos > orcamento.nos) return;
      if (k === S.length) { yield plano.map(r => r.slice()); return; }
      const i = S[k], x = days[i], salvo = streak.slice();
      if (!x.aberto) {
        for (let e = 0; e < E; e++) { plano[e][k] = fixed[e][i] === false ? false : true; streak[e] = plano[e][k] ? 0 : streak[e] + 1; }
        yield* dfs(k + 1);
        streak.splice(0, E, ...salvo);
        return;
      }
      const obrig = [], livres = [], trabalha = [], motivo = {};
      for (let e = 0; e < E; e++) {
        if (fixed[e][i] === true) { obrig.push(e); motivo[e] = "dia já definido no mês anterior"; }
        else if (fixed[e][i] === false) trabalha.push(e);
        else if (ff[e] === 6) { obrig.push(e); motivo[e] = "folga fixa no domingo"; }
        else if (streak[e] >= N[e] - 1) { obrig.push(e); motivo[e] = baseDomingo(cfg, cfg.equipe[e]); }
        else livres.push(e);
      }
      const setObrig = new Set(obrig);
      if (E - obrig.length < x.min || !gruposOk(setObrig)) {
        falhas.push({ tipo: "domingo", i, k, obrig: obrig.slice(), motivo: { ...motivo }, min: x.min, E });
        return;
      }
      const cap = Math.min(livres.length, E - obrig.length - x.min);
      const chave = e => (streak[e] + 1) / N[e] + rnd() * 0.35;
      const ordem = livres.map(e => ({ e, c: chave(e) })).sort((a, b) => b.c - a.c).map(o => o.e);
      let opcoes = 0, vistas = 0;
      for (let tam = cap; tam >= 0 && opcoes < 12; tam--) {
        for (const extra of combos(ordem, tam)) {
          if (opcoes >= 12 || ++vistas > 400) break;
          const folga = new Set([...obrig, ...extra]);
          if (!gruposOk(folga)) continue;
          opcoes++;
          for (let e = 0; e < E; e++) { plano[e][k] = folga.has(e); streak[e] = folga.has(e) ? 0 : streak[e] + 1; }
          yield* dfs(k + 1);
          streak.splice(0, E, ...salvo);
        }
      }
    }
    yield* dfs(0);
  }

  /* ============ fase 2: demais folgas, semana a semana, com cobertura obrigatória ============ */
  function contar(ctx, off) {
    const { days, E, gmin, grupoDe } = ctx;
    const cnt = new Array(days.length).fill(0), g = {};
    for (const k in gmin) g[k] = new Array(days.length).fill(0);
    for (let e = 0; e < E; e++) for (let i = 0; i < days.length; i++)
      if (days[i].aberto && !off[e][i]) { cnt[i]++; if (g[grupoDe[e]]) g[grupoDe[e]][i]++; }
    return { cnt, g };
  }

  function semana(ctx, off, w, ultimaFolga, pendFC, rnd) {
    const { days, E, gmin, grupoDe, fixed } = ctx;
    const idx = [...Array(7)].map((_, k) => w.i0 + k), dom = w.i0 + 6;
    const c = contar(ctx, off);
    // dias já abaixo do mínimo por causa de folgas fixas, domingo ou mês anterior
    for (const i of idx) {
      const x = days[i]; if (!x.aberto) continue;
      if (c.cnt[i] < x.min) return { ok: false, falha: { tipo: "dia", i, disp: c.cnt[i], min: x.min } };
      for (const g in gmin) if (c.g[g][i] < gmin[g]) return { ok: false, falha: { tipo: "dia", i, grupo: g, disp: c.g[g][i], min: gmin[g] } };
    }
    const inicio = off.map(r => r.slice());
    const F = new Fluxo(), S = F.no(), T = F.no();
    const dia = {}, porta = {}, ed = {};
    for (const i of idx) if (days[i].aberto && i !== dom) {
      dia[i] = F.no();
      const capD = c.cnt[i] - days[i].min;
      for (let u = 0; u < capD; u++) F.aresta(dia[i], T, 1, 4 * u);
      for (const g in gmin) { porta[g + "|" + i] = F.no(); F.aresta(porta[g + "|" + i], dia[i], c.g[g][i] - gmin[g], 0); }
    }
    const candidatos = e => idx.filter(i => i !== dom && days[i].aberto && !off[e][i] && fixed[e][i] === null);
    let demanda = 0;
    const detalhe = [];
    for (let e = 0; e < E; e++) {
      const tem = idx.filter(i => off[e][i]).length;
      let precisa = Math.max(0, w.req - tem);
      let cedo = 0, prazo = Infinity;
      if (w.antigo) {
        prazo = ultimaFolga[e] + 7;
        if (prazo <= w.i0 + 6 && !idx.some(i => off[e][i] && i <= prazo)) { cedo = 1; if (prazo < w.i0) prazo = w.i0; }
      }
      const resto = Math.max(0, precisa - cedo);
      const cand = candidatos(e);
      detalhe.push({ e, precisa: resto + cedo, cand: cand.length });
      if (!resto && !cedo) continue;
      const nCedo = F.no(), nResto = F.no();
      if (cedo) F.aresta(S, nCedo, cedo, 0);
      if (resto) F.aresta(S, nResto, resto, 0);
      demanda += cedo + resto;
      for (const i of cand) {
        const key = e + "|" + i;
        if (!(key in ed)) {
          ed[key] = F.no();
          let custo = rnd() * 2;
          if (off[e][i - 1] || off[e][i + 1]) custo -= 2;     // prefere folgas juntas
          if (days[i].fer) custo -= 6;                          // prefere folga no feriado aberto
          const g = grupoDe[e];
          F.aresta(ed[key], porta[g + "|" + i] !== undefined ? porta[g + "|" + i] : dia[i], 1, custo);
        }
        if (cedo && i <= prazo) F.aresta(nCedo, ed[key], 1, 0);
        if (resto) F.aresta(nResto, ed[key], 1, 0);
      }
    }
    const obtido = F.rodar(S, T, demanda);
    if (obtido < demanda) {
      return { ok: false, falha: { tipo: "semana", w, demanda, obtido, detalhe,
        dias: idx.filter(i => days[i].aberto && i !== dom).map(i => ({ i, disp: c.cnt[i], min: days[i].min })) } };
    }
    // folga compensatória (D9): feriado trabalhado nesta semana ou na anterior
    const aplicar = () => {
      for (const key in ed) {
        const [e, i] = key.split("|").map(Number);
        const usado = F.g[ed[key]].some(a => a.orig === 1 && a.cap === 0);
        off[e][i] = inicio[e][i] || usado;
      }
    };
    aplicar();
    const proxPend = new Array(E).fill(0);
    let demFC = 0;
    const feAgora = new Array(E).fill(0);
    for (let e = 0; e < E; e++) feAgora[e] = idx.filter(i => days[i].fer && days[i].aberto && !off[e][i]).length;
    const nFC = [];
    for (let e = 0; e < E; e++) {
      const p = pendFC[e] + feAgora[e];
      if (!p) { nFC.push(null); continue; }
      const n = F.no(); nFC.push(n); F.aresta(S, n, p, 0); demFC += p;
      for (const i of idx) {
        const key = e + "|" + i;
        if (i === dom || !days[i].aberto || off[e][i] || fixed[e][i] !== null) continue;
        if (!(key in ed)) {
          ed[key] = F.no();
          const g = grupoDe[e];
          F.aresta(ed[key], porta[g + "|" + i] !== undefined ? porta[g + "|" + i] : dia[i], 1, rnd());
        }
        F.aresta(n, ed[key], 1, 100); // custo alto: não desloca as folgas obrigatórias já distribuídas
      }
    }
    if (demFC) {
      F.rodar(S, T, demFC);
      const antes = off.map(r => r.slice());
      aplicar();
      for (let e = 0; e < E; e++) {
        const novos = idx.filter(i => off[e][i]).length - idx.filter(i => antes[e][i]).length;
        const usadosAnt = Math.min(novos, pendFC[e]);
        proxPend[e] = Math.max(0, feAgora[e] - (novos - usadosAnt));
      }
    } else for (let e = 0; e < E; e++) proxPend[e] = feAgora[e];
    return { ok: true, proxPend };
  }

  /* ============ geração ============ */
  function gerarEscala(cfg, opcoes = {}) {
    const ctx = contexto(cfg);
    const { days, E, weeks, fixed } = ctx;
    if (!E) return { ok: false, ctx, motivo: { titulo: "Nenhuma pessoa na equipe", detalhes: [], sugestoes: ["Adicione pelo menos uma pessoa."] } };
    const rnd = rng32((Number(cfg.seed) || 1) * 7919 + cfg.ano * 12 + cfg.mes);
    const ff = cfg.equipe.map(p => (p.folgaFixa === "" || p.folgaFixa == null) ? -1 : Number(p.folgaFixa));
    const base = cfg.equipe.map((p, e) => days.map((x, i) => {
      if (fixed[e][i] !== null) return fixed[e][i];
      return !x.aberto || x.dw === ff[e];
    }));
    const S = days.filter(x => x.dw === 6).map(x => x.i);
    const falhas = [];
    const orcamento = { nos: opcoes.nos || 40000 };
    let planos = 0;
    for (const plano of planosDomingo(ctx, rnd, falhas, orcamento)) {
      if (++planos > (opcoes.maxPlanos || 150)) break;
      const off = base.map(r => r.slice());
      for (let e = 0; e < E; e++) S.forEach((i, k) => { if (fixed[e][i] === null) off[e][i] = plano[e][k]; });
      const ultima = ctx.run0.map(r => -1 - r);
      let pend = new Array(E).fill(0), ok = true;
      for (const w of weeks) {
        const r = semana(ctx, off, w, ultima, pend, rnd);
        if (!r.ok) { falhas.push({ ...r.falha, plano: planos }); ok = false; break; }
        pend = r.proxPend;
        for (let e = 0; e < E; e++) for (let i = w.i0; i < w.i0 + 7; i++) if (off[e][i] || !days[i].aberto) ultima[e] = i;
      }
      if (ok) return { ok: true, ctx, off, planos };
    }
    return { ok: false, ctx, motivo: explicar(ctx, falhas), planos };
  }

  /* ============ explicação de inviabilidade ============ */
  function explicar(ctx, falhas) {
    const { days, cfg } = ctx;
    const nome = e => cfg.equipe[e].nome || `Pessoa ${e + 1}`;
    if (!falhas.length) return { titulo: "Não foi possível montar a escala", detalhes: ["Muitas combinações testadas sem solução."], sugestoes: ["Reduza os mínimos ou inclua mais pessoas."] };
    const doms = falhas.filter(f => f.tipo === "domingo");
    const outras = falhas.filter(f => f.tipo !== "domingo");
    if (!outras.length) {
      // o domingo mais à frente que travou: é o gargalo real
      const f = doms.reduce((a, b) => (b.k > a.k || (b.k === a.k && b.obrig.length > a.obrig.length)) ? b : a);
      const x = days[f.i], cabem = Math.max(0, f.E - f.min);
      return {
        titulo: `Domingo ${ddmm(x.d)}: folgas obrigatórias acima do possível`,
        detalhes: [
          `${f.obrig.length} pessoa${f.obrig.length === 1 ? "" : "s"} precisa${f.obrig.length === 1 ? "" : "m"} folgar neste domingo, mas com ${f.E} pessoas e mínimo de ${f.min} presentes só cabem ${cabem} folga${cabem === 1 ? "" : "s"}.`,
          ...f.obrig.map(e => `${nome(e)}: ${f.motivo[e]}`),
          "O gerador testou todas as formas de revezar os domingos anteriores e nenhuma resolve.",
        ],
        sugestoes: ["Reduza o mínimo de pessoas aos domingos.", "Inclua mais pessoas na equipe.", "Feche aos domingos.", "Confira o modelo de domingo de folga (etapa Dias abertos)."],
      };
    }
    const pos = x => x.tipo === "semana" ? x.w.i0 + 6 : x.i;
    const f = outras.reduce((a, b) => pos(b) > pos(a) ? b : a);
    if (f.tipo === "dia") {
      const x = days[f.i];
      return {
        titulo: `${DOW[x.dw]} ${ddmm(x.d)}: pessoas insuficientes${f.grupo ? ` no grupo "${f.grupo}"` : ""}`,
        detalhes: [`Só ${f.disp} pessoa${f.disp === 1 ? "" : "s"} pode${f.disp === 1 ? "" : "m"} trabalhar neste dia, e o mínimo é ${f.min}. As demais estão de folga fixa, de folga obrigatória no domingo ou com o dia já definido no mês anterior.`],
        sugestoes: ["Revise as folgas fixas da equipe.", "Reduza o mínimo deste dia da semana.", "Inclua mais pessoas."],
      };
    }
    const w = f.w, falta = f.demanda - f.obtido;
    return {
      titulo: `Semana de ${ddmm(w.ws)} a ${ddmm(addDays(w.ws, 6))}: faltam dias para as folgas`,
      detalhes: [
        `A equipe precisa de mais ${f.demanda} folga${f.demanda === 1 ? "" : "s"} nesta semana, mas os dias abertos só comportam ${f.obtido} sem ficar abaixo do mínimo (faltam ${falta}).`,
        ...f.dias.map(d => `${DOW[days[d.i].dw]} ${ddmm(days[d.i].d)}: ${d.disp} disponíve${d.disp === 1 ? "l" : "is"}, mínimo ${d.min} → cabem ${Math.max(0, d.disp - d.min)} folga${d.disp - d.min === 1 ? "" : "s"}`),
      ],
      sugestoes: ["Reduza o mínimo em algum dia desta semana.", "Inclua mais pessoas.", "Feche a empresa em algum dia da semana.", "Revise as folgas fixas."],
    };
  }

  /* ============ rótulos (item 4) ============
   * T   trabalho
   * FE  trabalho em feriado
   * RSR repouso semanal remunerado (as folgas obrigatórias da semana)
   * FER feriado sem trabalho (conta como repouso semanal — D1)
   * FG  folga da escala, além do repouso obrigatório
   * FC  folga compensatória por feriado trabalhado (nunca conta como repouso — J17, D9)
   */
  function rotular(ctx, off) {
    const { days, weeks, E } = ctx;
    const lab = [...Array(E)].map(() => new Array(days.length).fill("T"));
    for (let e = 0; e < E; e++) for (const w of weeks) {
      const idx = [...Array(7)].map((_, k) => w.i0 + k);
      const folgas = idx.filter(i => off[e][i] || !days[i].aberto);
      const peso = i => days[i].fer ? 0 : days[i].dw === 6 ? 1 : !days[i].aberto ? 2 : 3;
      const ordem = folgas.slice().sort((a, b) => peso(a) - peso(b) || a - b);
      let conta = 0;
      for (const i of ordem) {
        if (days[i].fer) { lab[e][i] = "FER"; conta++; }
        else if (conta < w.req) { lab[e][i] = "RSR"; conta++; }
        else lab[e][i] = "FG";
      }
      for (const i of idx) if (!off[e][i] && days[i].aberto && days[i].fer) lab[e][i] = "FE";
    }
    const dobras = [];
    for (let e = 0; e < E; e++) for (let i = 0; i < days.length; i++) {
      if (lab[e][i] !== "FE") continue;
      const w = Math.floor(i / 7), ini = w * 7, fim = Math.min(days.length, ini + 14);
      let achou = -1;
      for (let j = ini; j < fim; j++) if (lab[e][j] === "FG") { achou = j; break; }
      if (achou >= 0) lab[e][achou] = "FC"; else dobras.push({ e, i });
    }
    return { lab, dobras };
  }

  /* ============ conferência (independente do motor) ============ */
  function conferir(ctx, off) {
    const { cfg, days, weeks, E, gmin, grupoDe } = ctx;
    const al = [];
    const add = (nivel, titulo, texto, base) => al.push({ nivel, titulo, texto, base });
    const nome = e => cfg.equipe[e].nome || `Pessoa ${e + 1}`;
    const c = contar(ctx, off);
    const { lab, dobras } = rotular(ctx, off);

    // cobertura mínima — restrição obrigatória
    const faltas = [];
    days.forEach((x, i) => { if (x.inMonth && x.aberto && c.cnt[i] < x.min) faltas.push(`${ddmm(x.d)} (${c.cnt[i]} de ${x.min})`); });
    if (faltas.length) add("irregular", "Dias com menos pessoas que o mínimo", faltas.join("; ") + ".", "Cobertura mínima informada pela empresa");
    for (const g in gmin) {
      const fg = []; days.forEach((x, i) => { if (x.inMonth && x.aberto && c.g[g][i] < gmin[g]) fg.push(`${ddmm(x.d)} (${c.g[g][i]} de ${gmin[g]})`); });
      if (fg.length) add("irregular", `Grupo "${g}" abaixo do mínimo`, fg.join("; ") + ".", "Cobertura mínima informada pela empresa");
    }

    for (let e = 0; e < E; e++) {
      const p = cfg.equipe[e];
      // repouso semanal: conta folgas, menos as compensatórias
      for (const w of weeks) {
        const idx = [...Array(7)].map((_, k) => w.i0 + k);
        if (!idx.some(i => days[i].inMonth)) continue;
        const r = idx.filter(i => (off[e][i] || !days[i].aberto) && lab[e][i] !== "FC").length;
        if (r < w.req) add("irregular", `${nome(e)}: ${r} repouso${r === 1 ? "" : "s"} na semana de ${ddmm(w.ws)} a ${ddmm(addDays(w.ws, 6))}`,
          `O mínimo é ${w.req} por semana (segunda a domingo). Folga compensatória de feriado não conta.`,
          w.req === 2 ? "CF, art. 7º, XV (EC 141/2026)" : "CF, art. 7º, XV; CLT, art. 67");
      }
      // domingos
      const N = janelaDomingo(cfg, p);
      let s = ctx.streak0[e], viol = [];
      for (let i = 6; i < days.length; i += 7) {
        if (!days[i].aberto || off[e][i]) s = 0;
        else { s++; if (s >= N && days[i].inMonth) viol.push(ddmm(days[i].d)); }
      }
      if (viol.length) add("irregular", `${nome(e)}: domingos seguidos de trabalho acima do permitido`,
        `Precisa de pelo menos 1 domingo de folga a cada ${N} semanas. Domingos em excesso: ${viol.join(", ")}.`, baseDomingo(cfg, p));
      // dias seguidos no regime anterior (OJ 410)
      let run = ctx.run0[e], seq = [];
      for (let i = 0; i < days.length; i++) {
        if (!days[i].aberto || off[e][i]) run = 0;
        else { run++; if (run > 6 && weeks[Math.floor(i / 7)].antigo && days[i].inMonth) seq.push(ddmm(days[i].d)); }
      }
      if (seq.length) add("irregular", `${nome(e)}: mais de 6 dias seguidos de trabalho`, `No regime anterior à EC 141/2026 a folga deve ocorrer até o 7º dia. Dias: ${seq.join(", ")}.`, "OJ 410 da SDI-1/TST");

      // jornada (relógio — D7, D8)
      const j = jornada(p);
      if (!j) { add("atencao", `${nome(e)}: horário não informado`, "Informe entrada e saída para conferir jornada e intervalos.", "—"); continue; }
      if (!j.informouIntervalo && j.dur > 240) add("atencao", `${nome(e)}: intervalo não informado`,
        `Jornada de ${fmtH(j.dur)}. Acima de 4 h exige 15 min de intervalo; acima de 6 h, de 1 h a 2 h.`, "CLT, art. 71, caput e § 1º");
      else if (j.informouIntervalo && j.eff > 360 && j.itv < 60) add("irregular", `${nome(e)}: intervalo de ${j.itv} min`,
        "Jornada acima de 6 h exige intervalo mínimo de 1 h (30 min se a convenção coletiva permitir).", "CLT, art. 71, caput; art. 611-A, III");
      else if (j.informouIntervalo && j.eff > 240 && j.eff <= 360 && j.itv < 15) add("irregular", `${nome(e)}: intervalo de ${j.itv} min`,
        "Jornada acima de 4 h e até 6 h exige 15 min de intervalo.", "CLT, art. 71, § 1º");
      if (j.eff > 480) add("atencao", `${nome(e)}: ${fmtH(j.eff)} por dia`, "Acima de 8 h diárias só com acordo de compensação ou banco de horas.", "CF, art. 7º, XIII; CLT, arts. 58 e 59");
      if (1440 - j.dur < 660) add("irregular", `${nome(e)}: menos de 11 h entre jornadas`, `Entre a saída e a entrada do dia seguinte ficam ${fmtH(1440 - j.dur)}.`, "CLT, art. 66");
      if (j.not > 0) add("info", `${nome(e)}: ${fmtH(j.not)} noturnas por dia (${fmtH(j.notReduzida)} em hora reduzida)`,
        "Horário entre 22h e 5h. A escala usa horas de relógio; na folha, aplique a hora noturna de 52'30\" e o adicional.", "CLT, art. 73; decisão D7");
      const exc = [];
      for (const w of weeks) {
        const idx = [...Array(7)].map((_, k) => w.i0 + k);
        if (!idx.some(i => days[i].inMonth)) continue;
        const trab = idx.filter(i => days[i].aberto && !off[e][i]).length;
        if (trab * j.eff > w.limite) exc.push(`${ddmm(w.ws)} (${fmtH(trab * j.eff)} de ${w.limite / 60} h)`);
      }
      if (exc.length) add("irregular", `${nome(e)}: acima do limite semanal de horas`, `Semanas: ${exc.join("; ")}.`, "CF, art. 7º, XIII; EC 141/2026, art. 6º");
    }

    // feriados
    days.filter(x => x.inMonth && x.fer).forEach(x => {
      if (!x.fer.abre) add("info", `Feriado ${ddmm(x.d)} (${x.fer.nome}) sem expediente`, "O dia conta como uma das folgas da semana de todos (FER).", "Decisão D1; Lei 605/1949, art. 1º");
      if (x.fer.tipo === "confirmar") add("info", `${x.fer.nome} (${ddmm(x.d)})`, "Feriado religioso definido por lei municipal. Confirme se vale no seu município.", "Lei 9.093/1995");
    });
    const dobMes = dobras.filter(d => days[d.i].inMonth);
    if (dobMes.length) add("atencao", "Feriado trabalhado sem folga compensatória",
      dobMes.map(d => `${nome(d.e)} em ${ddmm(days[d.i].d)}`).join("; ") + ". Pague o dia em dobro na folha.", "Lei 605/1949, art. 9º; Súmula 146 do TST; decisão D9");
    const comFC = []; for (let e = 0; e < E; e++) for (let i = 0; i < days.length; i++) if (lab[e][i] === "FC" && days[i].inMonth) comFC.push(`${nome(e)} em ${ddmm(days[i].d)}`);
    if (comFC.length) add("info", "Folgas compensatórias de feriado (FC)", comFC.join("; ") + ".", "Lei 605/1949, art. 9º; decisão D9");

    if (ctx.temHistorico.some(Boolean)) add("info", "Continuação do mês anterior", `Os dias anteriores a ${br(ctx.first)} vieram da escala anterior e não foram alterados.`, "—");
    else add("info", "Mês anterior não informado", "As semanas que começam no mês anterior foram completadas por projeção. Para conferir a virada do mês, gere o mês anterior e use “Continuar no mês seguinte”.", "—");

    const nIrregular = al.filter(a => a.nivel === "irregular").length;
    return { alertas: al, valido: nIrregular === 0, nIrregular, cnt: c.cnt, gcnt: c.g, lab, dobras };
  }

  /* ============ resumo e continuidade ============ */
  function resumo(ctx, off, lab) {
    const { cfg, days } = ctx;
    return cfg.equipe.map((p, e) => {
      const r = { p, T: 0, RSR: 0, FG: 0, FER: 0, FC: 0, FE: 0, dom: 0, horas: 0 };
      const j = jornada(p);
      days.filter(x => x.inMonth).forEach(x => {
        const c = lab[e][x.i]; r[c]++;
        if ((c === "T" || c === "FE") && x.dw === 6) r.dom++;
      });
      r.trab = r.T + r.FE; r.folgas = r.RSR + r.FG + r.FER + r.FC;
      r.horas = j ? r.trab * j.eff : 0;
      return r;
    });
  }

  function historicoDe(ctx, off) {
    const { cfg, days } = ctx;
    const ant = (cfg.historico && cfg.historico.porPessoa) || {};
    const porPessoa = {};
    const limite = iso(addDays(ctx.last, -70));
    cfg.equipe.forEach((p, e) => {
      const h = {};
      for (const k in (ant[p.nome] || {})) if (k >= limite) h[k] = ant[p.nome][k];
      days.forEach((x, i) => { if (x.inMonth || ctx.fixed[e][i] !== null) h[x.k] = !!(off[e][i] || !x.aberto); });
      porPessoa[p.nome] = h;
    });
    return { ate: iso(ctx.last), porPessoa };
  }

  const Motor = {
    DOW, VIG_2F, VIG_40, ud, addDays, iso, dowOf, ddmm, br, fromIso, toMin, fmtH,
    pascoa, feriadosDoAno, feriadosDoMes, folgasSemana, regimeAntigo, limiteSemanal, janelaDomingo, baseDomingo,
    jornada, contexto, contar, gerarEscala, rotular, conferir, resumo, historicoDe, rng32,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
  else root.Motor = Motor;
})(typeof globalThis !== "undefined" ? globalThis : this);
