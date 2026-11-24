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
  const regimeAntigo = ws => fimSemana(ws) < VIG_2F;
  const MAX_DIAS_SEGUIDOS = 6; // J12 (D10): OJ 410 da SDI-1/TST e Tema Repetitivo 265 — vale em qualquer regime
  /* J04, J05, D11 — limites de jornada por período de vigência (minutos inteiros).
   * Alterações futuras: editar só esta tabela. */
  const PERIODOS_JORNADA = [
    { id: "pre-ec141", ate: "2026-12-15", semanal: 2640, diario: 480, transitorio: null,
      base: "CF, art. 7º, XIII (redação original); CLT, art. 58" },
    { id: "ec141-42h", de: "2026-12-16", ate: "2027-12-15", semanal: 2520, diario: 480, transitorio: 504,
      base: "EC 141/2026, art. 6º, I; STF, ADIs 8.041 e 8.042 (cautelar de 12/11/2026)" },
    { id: "ec141-40h", de: "2027-12-16", semanal: 2400, diario: 480, transitorio: null,
      base: "CF, art. 7º, XIII (red. EC 141/2026); EC 141/2026, art. 6º, II" },
  ];
  function periodoJornada(k) { // k = data "AAAA-MM-DD"
    return PERIODOS_JORNADA.find(x => (!x.de || k >= x.de) && (!x.ate || k <= x.ate));
  }
  /* norma coletiva da escala: { situacao: "nao_sei" | "nao" | "sim", diario: "HH:MM", semanal: horas } */
  function limitesJornada(cfg, k) {
    const per = periodoJornada(k), n = (cfg && cfg.normaColetiva) || { situacao: "nao_sei" };
    let diario = per.diario, semanal = per.semanal, origem = "lei", duvida = null, base = per.base;
    if (n.situacao === "sim") {
      const d = toMin(n.diario); if (d) diario = d;
      const sem = Number(n.semanal) > 0 ? Math.round(Number(n.semanal) * 60) : null;
      if (sem) semanal = Math.min(semanal, sem);
      origem = "coletiva"; base = "Norma coletiva informada; " + per.base;
    } else if (per.transitorio) {
      if (n.situacao === "nao") { diario = per.transitorio; origem = "stf"; }
      else duvida = per.transitorio;   // não sabe se há norma: 8h–8h24 fica "a confirmar"
    }
    return { periodo: per.id, diario, semanal, origem, duvida, base };
  }
  function limiteSemanal(ws, cfg) { return limitesJornada(cfg, iso(addDays(ws, 6))).semanal; }
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
    let itv = 0, intervaloInvalido = null;
    // A-01/A-02: o intervalo precisa estar inteiro dentro do turno, com início antes do fim
    if ((ii == null) !== (fi == null)) intervaloInvalido = "incompleto";
    else if (ii != null) {
      const a = (ii - en + 1440) % 1440, b = (fi - en + 1440) % 1440;   // posição em minutos a partir da entrada
      if (a === 0 || a >= dur || b === 0 || b > dur) intervaloInvalido = "fora do horário de trabalho";
      else if (b <= a) intervaloInvalido = "com início depois do fim";
      else itv = b - a;
    }
    const noturno = (ini, len) => { let n = 0; for (let k = 0; k < len; k++) { const mm = (ini + k) % 1440; if (mm >= 1320 || mm < 300) n++; } return n; };
    const not = Math.max(0, noturno(en, dur) - (itv ? noturno(ii, itv) : 0));
    const eff = dur - itv;
    return {
      dur, itv, eff, not,
      notReduzida: not * 60 / 52.5,          // CLT, art. 73, § 1º
      computadas: eff - not + not * 60 / 52.5,
      cruza: en + dur > 1440,
      informouIntervalo: itv > 0,
      intervaloInvalido,                      // texto do problema, ou null; com intervalo inválido as horas contam sem desconto
    };
  }

  /* horário da pessoa num dia da semana (0 = segunda): o específico do dia, se houver, ou o padrão */
  const DOW_EXT = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
  function horarioDia(p, dw) {
    const h = p.horariosDia && p.horariosDia[dw];
    return h && h.entrada && h.saida ? h : p;
  }
  const jornadaDia = (p, dw) => jornada(horarioDia(p, dw));
  /* faixa do turno em minutos (o fim pode passar de 1440) e sobreposição entre dois turnos */
  function faixa(h) { const j = jornada(h); if (!j) return null; const ini = toMin(h.entrada); return { ini, fim: ini + j.dur }; }
  function sobreposicao(a, b) {
    let m = 0; for (const d of [-1440, 0, 1440]) m = Math.max(m, Math.min(a.fim, b.fim + d) - Math.max(a.ini, b.ini + d));
    return Math.max(0, m);
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
      weeks.push({ i0: i, ws, req: folgasSemana(cfg, ws), antigo: regimeAntigo(ws), limite: limiteSemanal(ws, cfg) });
    }
    const grupoDe = cfg.equipe.map(p => String(p.grupo || "").trim());
    const gmin = {};
    const gruposPrincipais = new Set(grupoDe.filter(Boolean));
    for (const g of gruposPrincipais) { const v = Number((cfg.grupoMin || {})[g]) || 0; if (v > 0) gmin[g] = v; }
    // máximo por área (preferência) e funções que cada pessoa também pode exercer
    const gmax = {};
    for (const g of gruposPrincipais) { const v = Number((cfg.grupoMax || {})[g]); if (v > 0) gmax[g] = v; }
    // horário típico de cada área (o mais comum entre quem é da área)
    const turnoArea = {};
    for (const g of gruposPrincipais) {
      const cont = {};
      cfg.equipe.forEach((p, e) => { if (grupoDe[e] === g && p.entrada && p.saida) { const k = p.entrada + "–" + p.saida; cont[k] = (cont[k] || 0) + 1; } });
      const k = Object.keys(cont).sort((a, b) => cont[b] - cont[a])[0];
      if (k) { const [entrada, saida] = k.split("–"); turnoArea[g] = { entrada, saida, intIni: "", intFim: "" }; }
    }
    const extrasIgnoradas = [];
    const capaz = cfg.equipe.map((p, e) => {
      const c = new Set(grupoDe[e] ? [grupoDe[e]] : []);
      for (const x of (p.funcoesExtras || [])) {
        const t = String(x).trim(); if (!t || !gruposPrincipais.has(t)) continue;
        // só cobre outra área se o horário coincidir em pelo menos 75% com o turno daquela área
        const a = faixa(p), b = turnoArea[t] && faixa(turnoArea[t]);
        if (a && b && sobreposicao(a, b) < 0.75 * (b.fim - b.ini)) { extrasIgnoradas.push({ e, g: t, deles: turnoArea[t] }); continue; }
        c.add(t);
      }
      return [...c];
    });
    const cobertos = new Set();
    capaz.forEach((c, e) => c.forEach(g => { if (g !== grupoDe[e]) cobertos.add(g); }));
    const multi = cobertos.size > 0 || Object.keys(gmax).length > 0;

    // continuidade: dias já definidos no mês anterior (J24)
    const hist = cfg.historico || null;
    const fixed = cfg.equipe.map(p => days.map(x => {
      const h = hist && hist.porPessoa && hist.porPessoa[p.nome];
      return h && Object.prototype.hasOwnProperty.call(h, x.k) ? !!h[x.k] : null;
    }));
    // dias travados pelo usuário (edições manuais preservadas na correção automática)
    const travas = cfg.travas || {};
    const travado = cfg.equipe.map(p => days.map(x => {
      const t = travas[p.nome];
      return t && Object.prototype.hasOwnProperty.call(t, x.k) ? !!t[x.k] : null;
    }));
    // o que o motor não pode mudar: mês anterior + travas
    const fixo = cfg.equipe.map((_, e) => days.map((_, i) => fixed[e][i] !== null ? fixed[e][i] : travado[e][i]));
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
    return { cfg, days, weeks, grupoDe, gmin, gmax, capaz, cobertos, multi, extrasIgnoradas, first, last, start, end, fixed, travado, fixo, streak0, run0, temHistorico, E };
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

  /* ============ funções do dia (área principal ou outra que a pessoa também exerce) ============
   * Fluxo de custo mínimo: primeiro completa os mínimos de cada área, prefere a área principal
   * e respeita o máximo quando houver outra função possível. */
  function atribuirDia(ctx, trab) {
    const { gmin, gmax, capaz, grupoDe } = ctx;
    const grupos = [...new Set([...Object.keys(gmin), ...Object.keys(gmax), ...trab.flatMap(e => capaz[e])])];
    const F = new Fluxo(), S = F.no(), T = F.no(), nG = {}, n = trab.length;
    for (const g of grupos) {
      nG[g] = F.no();
      const mn = gmin[g] || 0, mx = gmax[g];
      if (mn) F.aresta(nG[g], T, mn, -1000);
      if (mx == null) F.aresta(nG[g], T, n, 0);
      else { if (mx > mn) F.aresta(nG[g], T, mx - mn, 0); F.aresta(nG[g], T, n, 100); }
    }
    const ligacoes = [];
    for (const e of trab) {
      const ne = F.no(); F.aresta(S, ne, 1, 0);
      if (!grupoDe[e]) F.aresta(ne, T, 1, 5);                 // sem área principal: pode ficar sem função específica
      for (const g of capaz[e]) ligacoes.push([e, g, F.aresta(ne, nG[g], 1, g === grupoDe[e] ? 0 : 10)]);
    }
    F.rodar(S, T, n);
    const funcao = {}, contagem = {}, faltas = {}, excesso = {};
    for (const g of grupos) contagem[g] = 0;
    for (const [e, g, a] of ligacoes) if (a.cap === 0) { funcao[e] = g; contagem[g]++; }
    for (const g of Object.keys(gmin)) faltas[g] = Math.max(0, gmin[g] - contagem[g]);
    for (const g of Object.keys(gmax)) excesso[g] = Math.max(0, contagem[g] - gmax[g]);
    return { funcao, contagem, faltas, excesso };
  }
  const faltasTotal = a => Object.values(a.faltas).reduce((t, v) => t + v, 0);

  /* ============ fase 1: folgas de domingo no mês inteiro ============ */
  function* planosDomingo(ctx, rnd, falhas, orcamento) {
    const { cfg, days, E, gmin, grupoDe } = ctx;
    const fixed = ctx.fixo;
    const S = days.filter(x => x.dw === 6).map(x => x.i);
    const N = cfg.equipe.map(p => janelaDomingo(cfg, p));
    const ff = cfg.equipe.map(p => (p.folgaFixa === "" || p.folgaFixa == null) ? -1 : Number(p.folgaFixa));
    const streak = ctx.streak0.slice();
    const plano = cfg.equipe.map(() => new Array(S.length).fill(false));
    const gruposOk = folga => ctx.multi
      ? faltasTotal(atribuirDia(ctx, [...Array(E).keys()].filter(e => !folga.has(e)))) === 0
      : Object.keys(gmin).every(g => grupoDe.filter((gg, e) => gg === g && !folga.has(e)).length >= gmin[g]);
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
        if (fixed[e][i] === true) { obrig.push(e); motivo[e] = ctx.fixed[e][i] !== null ? "dia já definido no mês anterior" : "folga marcada manualmente"; }
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
      const vistosK = new Set();
      function* tentar(extra) {
        const chaveOp = extra.slice().sort((a, b) => a - b).join(",");
        if (vistosK.has(chaveOp)) return;
        vistosK.add(chaveOp);
        const folga = new Set([...obrig, ...extra]);
        if (!gruposOk(folga)) return;
        opcoes++;
        for (let e = 0; e < E; e++) { plano[e][k] = folga.has(e); streak[e] = folga.has(e) ? 0 : streak[e] + 1; }
        yield* dfs(k + 1);
        streak.splice(0, E, ...salvo);
      }
      // A-03: opções montadas por área — cada área só cede folgas até o seu mínimo
      const cota0 = {};
      for (const g of Object.keys(gmin)) cota0[g] = grupoDe.filter((gg, e) => gg === g && !setObrig.has(e)).length - gmin[g];
      const porArea = (lista, tam) => {
        const cota = { ...cota0 }, esc = [];
        for (const e of lista) {
          if (esc.length >= tam) break;
          const g = grupoDe[e];
          if (cota[g] !== undefined) { if (cota[g] <= 0) continue; cota[g]--; }
          esc.push(e);
        }
        return esc;
      };
      if (Object.keys(gmin).length) {
        for (let tam = cap; tam >= Math.max(0, cap - 3) && opcoes < 12; tam--) yield* tentar(porArea(ordem, tam));
        for (let v = 0; v < 4 && opcoes < 12; v++) {
          const outra = livres.map(e => ({ e, c: chave(e) + rnd() * 0.8 })).sort((a, b) => b.c - a.c).map(o => o.e);
          yield* tentar(porArea(outra, cap));
        }
      }
      // combinações gerais, como antes
      for (let tam = cap; tam >= 0 && opcoes < 12; tam--) {
        for (const extra of combos(ordem, tam)) {
          if (opcoes >= 12 || ++vistas > 400) break;
          yield* tentar(extra);
        }
      }
      if (!opcoes) falhas.push({ tipo: "domingo-areas", i, k, cap, obrig: obrig.slice() });
    }
    yield* dfs(0);
  }

  /* folgas mínimas da semana: repouso legal e, além dele, o necessário para as horas
   * ordinárias (até o limite diário) não passarem do limite semanal — D11 */
  function ordinariaDia(ctx, e, i) {   // horas ordinárias do dia: trabalho até o limite diário daquela data
    const x = ctx.days[i], j = jornadaDia(ctx.cfg.equipe[e], x.dw);
    if (!j) return 0;
    const lim = limitesJornada(ctx.cfg, x.k);
    return Math.min(j.eff, lim.duvida || lim.diario);
  }
  function ordinariasSemana(ctx, off, e, w) {
    let t = 0; for (let i = w.i0; i < w.i0 + 7; i++) if (ctx.days[i].aberto && !off[e][i]) t += ordinariaDia(ctx, e, i);
    return t;
  }
  function folgasMinimas(ctx, e, w) {
    // quantos dias cabem no limite semanal usando os dias de jornada mais curta (o gerador confere depois)
    const ord = [];
    for (let i = w.i0; i < w.i0 + 7; i++) if (ctx.days[i].aberto) ord.push(ordinariaDia(ctx, e, i));
    if (!ord.length || ord.every(v => v <= 0)) return w.req;
    ord.sort((a, b) => a - b);
    let soma = 0, k = 0;
    for (const v of ord) { if (soma + v > w.limite) break; soma += v; k++; }
    return Math.min(7, Math.max(w.req, 7 - k));
  }

  /* ============ fase 2: demais folgas, semana a semana, com cobertura obrigatória ============ */
  function contar(ctx, off) {
    const { days, E, gmin, gmax, grupoDe } = ctx;
    const cnt = new Array(days.length).fill(0), g = {}, gp = {};
    for (const k in gmin) { g[k] = new Array(days.length).fill(0); gp[k] = new Array(days.length).fill(0); }
    for (let e = 0; e < E; e++) for (let i = 0; i < days.length; i++)
      if (days[i].aberto && !off[e][i]) { cnt[i]++; if (gp[grupoDe[e]]) gp[grupoDe[e]][i]++; }
    if (!ctx.multi) { for (const k in gp) g[k] = gp[k].slice(); return { cnt, g, gp, funcao: null, excesso: null }; }
    const funcao = [...Array(E)].map(() => new Array(days.length).fill(null));
    const excesso = {}; for (const k in gmax) excesso[k] = new Array(days.length).fill(0);
    for (let i = 0; i < days.length; i++) {
      if (!days[i].aberto) continue;
      const a = atribuirDia(ctx, [...Array(E).keys()].filter(e => !off[e][i]));
      for (const k in gmin) g[k][i] = a.contagem[k] || 0;
      for (const k in gmax) excesso[k][i] = a.excesso[k] || 0;
      for (const e in a.funcao) funcao[e][i] = a.funcao[e];
    }
    return { cnt, g, gp, funcao, excesso };
  }

  /* sequência de dias trabalhados até o dia "ate" não passa de 6 (OJ 410) */
  function seguidosAte(ctx, off, e, ate) {
    let run = ctx.run0[e];
    for (let i = 0; i <= ate; i++) { if (!ctx.days[i].aberto || off[e][i]) run = 0; else if (++run > MAX_DIAS_SEGUIDOS) return false; }
    return true;
  }

  /* com funções extras, a cobertura por área é conferida dia a dia e as folgas são trocadas
   * dentro da semana até todos os mínimos fecharem */
  function repararAreas(ctx, off, w, inicio) {
    const { days, E, gmin } = ctx, fixed = ctx.fixo, dom = w.i0 + 6;
    const idx = [...Array(7)].map((_, k) => w.i0 + k);
    const falta = i => {
      if (!days[i].aberto) return 0;
      const trab = [...Array(E).keys()].filter(e => !off[e][i]);
      if (trab.length < days[i].min) return 999;
      return faltasTotal(atribuirDia(ctx, trab));
    };
    for (let passo = 0; passo < 6; passo++) {
      const ruins = idx.filter(i => i !== dom && falta(i) > 0);
      if (!ruins.length) break;
      let melhorou = false;
      for (const i of ruins) for (let e = 0; e < E && falta(i) > 0; e++) {
        if (!off[e][i] || inicio[e][i]) continue;
        for (const j of idx) {
          if (j === i || j === dom || off[e][j] || !days[j].aberto || fixed[e][j] !== null) continue;
          const antes = falta(i) + falta(j);
          off[e][i] = false; off[e][j] = true;
          if (falta(i) + falta(j) < antes && seguidosAte(ctx, off, e, w.i0 + 6)) { melhorou = true; break; }
          off[e][i] = true; off[e][j] = false;
        }
      }
      if (!melhorou) break;
    }
    const i = idx.find(i => falta(i) > 0);
    if (i === undefined) return { ok: true };
    const trab = [...Array(E).keys()].filter(e => !off[e][i]);
    if (trab.length < days[i].min) return { ok: false, falha: { tipo: "dia", i, disp: trab.length, min: days[i].min } };
    const a = atribuirDia(ctx, trab), g = Object.keys(gmin).find(k => a.faltas[k] > 0);
    return { ok: false, falha: { tipo: "dia", i, grupo: g, disp: a.contagem[g] || 0, min: gmin[g] } };
  }

  function semana(ctx, off, w, ultimaFolga, pendFC, rnd) {
    const { days, E, gmin, grupoDe } = ctx;
    const fixed = ctx.fixo;
    const idx = [...Array(7)].map((_, k) => w.i0 + k), dom = w.i0 + 6;
    const c = contar(ctx, off);
    // dias já abaixo do mínimo por causa de folgas fixas, domingo ou mês anterior
    for (const i of idx) {
      const x = days[i]; if (!x.aberto) continue;
      if (c.cnt[i] < x.min) return { ok: false, falha: { tipo: "dia", i, disp: c.cnt[i], min: x.min } };
      for (const g in gmin) if (c.g[g][i] < gmin[g]) return { ok: false, falha: { tipo: "dia", i, grupo: g, disp: c.g[g][i], min: gmin[g] } };
    }
    const inicio = off.map(r => r.slice());
    const extra = new Array(E).fill(0);   // folgas a mais para quem passou do limite semanal de horas
    let F, S, T, dia, porta, ed, aplicar;
    for (let tentativa = 0; ; tentativa++) {
    for (let e = 0; e < E; e++) off[e] = inicio[e].slice();
    F = new Fluxo(); S = F.no(); T = F.no();
    dia = {}; porta = {}; ed = {};
    for (const i of idx) if (days[i].aberto && i !== dom) {
      dia[i] = F.no();
      const capD = c.cnt[i] - days[i].min;
      for (let u = 0; u < capD; u++) F.aresta(dia[i], T, 1, 4 * u);
      for (const g in gmin) {
        if (ctx.multi && ctx.cobertos.has(g)) continue;   // área coberta também por outras funções: conferida depois, dia a dia
        porta[g + "|" + i] = F.no(); F.aresta(porta[g + "|" + i], dia[i], Math.max(0, c.gp[g][i] - gmin[g]), 0);
      }
    }
    const candidatos = e => idx.filter(i => i !== dom && days[i].aberto && !off[e][i] && fixed[e][i] === null);
    let demanda = 0;
    const detalhe = [];
    for (let e = 0; e < E; e++) {
      const tem = idx.filter(i => off[e][i]).length;
      let precisa = Math.max(0, folgasMinimas(ctx, e, w) + extra[e] - tem);
      let cedo = 0, prazo = Infinity;
      {
        prazo = ultimaFolga[e] + MAX_DIAS_SEGUIDOS + 1;   // OJ 410: folga até o 7º dia
        if (prazo <= w.i0 + 6 && !idx.some(i => off[e][i] && i <= prazo)) { cedo = 1; if (prazo < w.i0) prazo = w.i0; }
      }
      const resto = Math.max(0, precisa - cedo);
      const cand = candidatos(e);
      detalhe.push({ e, precisa: resto + cedo, cand: cand.length, porHoras: folgasMinimas(ctx, e, w) > w.req });
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
          custo -= ordinariaDia(ctx, e, i) / 480;               // prefere folga nos dias de jornada mais longa
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
    aplicar = () => {
      for (const key in ed) {
        const [e, i] = key.split("|").map(Number);
        const usado = F.g[ed[key]].some(a => a.orig === 1 && a.cap === 0);
        off[e][i] = inicio[e][i] || usado;
      }
    };
    aplicar();
    // horários diferentes por dia: confere as horas ordinárias da semana de cada pessoa
    const passou = [...Array(E).keys()].filter(e => ordinariasSemana(ctx, off, e, w) > w.limite);
    if (!passou.length) break;
    if (tentativa >= 2) return { ok: false, falha: { tipo: "semana", w, demanda, obtido: Math.max(0, demanda - passou.length),
      detalhe: detalhe.map(d => ({ ...d, porHoras: d.porHoras || passou.includes(d.e) })),
      dias: idx.filter(i => days[i].aberto && i !== dom).map(i => ({ i, disp: c.cnt[i], min: days[i].min })) } };
    passou.forEach(e => extra[e]++);
    }
    // folga compensatória (D9): feriado trabalhado nesta semana ou na anterior
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
    if (ctx.multi) {
      const r = repararAreas(ctx, off, w, inicio);
      if (!r.ok) return r;
    }
    return { ok: true, proxPend };
  }

  /* ============ geração ============ */
  function gerarEscala(cfg, opcoes = {}) {
    const ctx = contexto(cfg);
    const { days, E, weeks } = ctx;
    const fixed = ctx.fixo;
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
    if (f.tipo === "domingo-areas") {
      const x = days[f.i];
      const areas = Object.entries(ctx.gmin).map(([g, v]) => `${g}: ${ctx.grupoDe.filter(gg => gg === g).length} pessoas, mínimo ${v}`);
      return {
        titulo: `Domingo ${ddmm(x.d)}: não há como escolher as folgas respeitando o mínimo de cada área`,
        detalhes: [
          `Neste domingo cabem até ${f.cap} folgas além das obrigatórias, mas nenhuma combinação deixa todas as áreas com o mínimo de pessoas e cumpre o revezamento dos domingos.`,
          ...areas,
        ],
        sugestoes: ["Reduza o mínimo de alguma área ou o mínimo do domingo.", "Inclua mais pessoas nas áreas com mínimo alto.", "Marque “Também pode trabalhar como” para quem pode cobrir outra área no mesmo horário."],
      };
    }
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
      sugestoes: [
        ...(f.detalhe.some(d => d.porHoras) ? [`Algumas pessoas precisam de mais folgas para não passar do limite semanal de ${w.limite / 60} h com a jornada diária informada. Revise os horários ou a norma coletiva.`] : []),
        "Reduza o mínimo em algum dia desta semana.", "Inclua mais pessoas.", "Feche a empresa em algum dia da semana.", "Revise as folgas fixas."],
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

  /* ============ horas extras (D11) ============
   * diária  = minutos acima do limite diário do dia;
   * semanal = horas ordinárias da semana (cada dia limitado ao limite diário) acima do limite semanal.
   * Assim, o que já é extra pelo critério diário não volta a ser contado no semanal. */
  function horasExtras(ctx, off, e) {
    const { cfg, days, weeks } = ctx, p = cfg.equipe[e];
    if (!jornada(p) && !Object.values(p.horariosDia || {}).some(h => h && h.entrada && h.saida)) return null;
    return weeks.filter(w => days.slice(w.i0, w.i0 + 7).some(x => x.inMonth)).map(w => {
      let trab = 0, ordinarias = 0, diaria = 0, aConfirmar = 0, diasTrab = 0;
      const porDia = [];
      for (let i = w.i0; i < w.i0 + 7; i++) {
        const x = days[i]; if (!x.aberto || off[e][i]) continue;
        const j = jornadaDia(p, x.dw); if (!j) continue;
        const lim = limitesJornada(cfg, x.k);
        const teto = lim.duvida || lim.diario;                 // "não sei": acima de 8h24 é extra certo
        const exc = Math.max(0, j.eff - teto);
        const duv = lim.duvida ? Math.max(0, Math.min(j.eff, lim.duvida) - lim.diario) : 0;
        trab += j.eff; diaria += exc; aConfirmar += duv; diasTrab++;
        ordinarias += j.eff - exc;
        porDia.push({ i, k: x.k, trabalho: j.eff, limite: teto, extra: exc, aConfirmar: duv });
      }
      const semanal = Math.max(0, ordinarias - w.limite);
      return { ws: w.ws, limiteSemanal: w.limite, diasTrab, trab, ordinarias: ordinarias - semanal, diaria, semanal, total: diaria + semanal, aConfirmar, porDia };
    });
  }

  /* ============ OJ 410: sequências de mais de 6 dias de trabalho ============ */
  function sequenciasLongas(ctx, off, e) {
    const { days } = ctx, out = [];
    let run = ctx.run0[e], ini = run ? addDays(days[0].d, -run) : null, toca = false;
    const fecha = i => { if (run > MAX_DIAS_SEGUIDOS && toca) out.push({ ini, fim: days[i - 1].d, dias: run }); };
    for (let i = 0; i < days.length; i++) {
      if (!days[i].aberto || off[e][i]) { fecha(i); run = 0; toca = false; ini = null; }
      else { if (!run) ini = days[i].d; run++; if (days[i].inMonth) toca = true; }
    }
    fecha(days.length);
    return out;
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

    // máximo por área (preferência): avisa quando não foi possível remanejar
    if (c.excesso) for (const g in c.excesso) {
      const dias = []; days.forEach((x, i) => { if (x.inMonth && c.excesso[g][i] > 0) dias.push(`${ddmm(x.d)} (${(c.g[g] ? c.g[g][i] : ctx.gmax[g] + c.excesso[g][i])} pessoas)`); });
      if (dias.length) add("atencao", `Área "${g}" acima do máximo de ${ctx.gmax[g]}`,
        `${dias.join("; ")}. Ninguém dessa área pode trabalhar em outra função nesses dias. Marque “Também pode trabalhar como” no cadastro ou aceite o excesso.`, "Regra da empresa");
    }
    for (const x of ctx.extrasIgnoradas || []) add("info", `${nome(x.e)}: não cobre a área "${x.g}"`,
      `O horário dela (${cfg.equipe[x.e].entrada}–${cfg.equipe[x.e].saida}) é diferente do turno da área ${x.g} (${x.deles.entrada}–${x.deles.saida}). A função extra só vale para áreas no mesmo horário.`, "Regra da ferramenta");
    // desvio ou acúmulo de função
    if (c.funcao) for (let e = 0; e < E; e++) {
      const fora = {}; days.forEach((x, i) => { const f = c.funcao[e][i]; if (x.inMonth && f && f !== grupoDe[e]) fora[f] = (fora[f] || 0) + 1; });
      const lista = Object.entries(fora);
      if (lista.length) add("atencao", `${nome(e)}: trabalha em outra função`,
        `${lista.map(([f, n]) => `${n} dia${n === 1 ? "" : "s"} como ${f}`).join("; ")}${grupoDe[e] ? ` (função principal: ${grupoDe[e]})` : ""}. Exercer outra função com habitualidade pode caracterizar desvio ou acúmulo de função, com risco de diferença salarial. Confira o contrato e a convenção coletiva.`,
        "CLT, art. 456, parágrafo único; art. 468");
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
      // OJ 410: sequência contínua, sem reiniciar na troca de semana, mês ou ano
      for (const v of sequenciasLongas(ctx, off, e)) {
        add("irregular", `Violação da OJ 410 do TST: ${nome(e)}`,
          `Período: ${br(v.ini)} a ${br(v.fim)}. Dias consecutivos trabalhados: ${v.dias}. Irregularidade: ausência de repouso semanal dentro do limite de 6 dias. ` +
          `Correção sugerida: antecipar uma folga antes do 7º dia consecutivo (botão “Corrigir automaticamente”).`,
          "CF, art. 7º, XV; OJ 410 da SDI-1 do TST; Tema Repetitivo 265 do TST");
      }

      // jornada (relógio — D7, D8)
      const j = jornada(p);
      if (!j) { add("atencao", `${nome(e)}: horário não informado`, "Informe entrada e saída para conferir jornada e intervalos.", "—"); continue; }
      const horarios = [{ rot: "", h: p }, ...Object.entries(p.horariosDia || {}).filter(([, h]) => h && h.entrada && h.saida).map(([dw, h]) => ({ rot: ` (${DOW_EXT[dw]})`, h }))];
      for (const { rot, h } of horarios) {
        const jj = jornada(h); if (!jj) continue;
        if (jj.intervaloInvalido) {
          add("irregular", `${nome(e)}${rot}: intervalo ${jj.intervaloInvalido}`,
            `O intervalo (${h.intIni || "?"} às ${h.intFim || "?"}) precisa começar e terminar dentro do horário de trabalho (${h.entrada} às ${h.saida}). Corrija o cadastro; enquanto isso, as horas são contadas sem descontar o intervalo.`,
            "CLT, art. 71");
          continue;
        }
        // D13: até 6 h o intervalo de 15 min é considerado concedido, mesmo sem estar preenchido;
        // acima de 6 h o intervalo de no mínimo 1 h é obrigatório
        if (jj.eff > 360 && !jj.informouIntervalo) add("irregular", `${nome(e)}${rot}: jornada de ${fmtH(jj.dur)} sem intervalo`,
          "Acima de 6 h de trabalho contínuo é obrigatório intervalo de no mínimo 1 h (30 min se a convenção coletiva permitir). Informe o intervalo.", "CLT, art. 71, caput; art. 611-A, III");
        else if (jj.informouIntervalo && jj.eff > 360 && jj.itv < 60) add("irregular", `${nome(e)}${rot}: intervalo de ${jj.itv} min`,
          "Jornada acima de 6 h exige intervalo mínimo de 1 h (30 min se a convenção coletiva permitir).", "CLT, art. 71, caput; art. 611-A, III");
        if (jj.not > 0) add("info", `${nome(e)}${rot}: ${fmtH(jj.not)} noturnas por dia (${fmtH(jj.notReduzida)} em hora reduzida)`,
          "Horário entre 22h e 5h. A escala usa horas de relógio; na folha, aplique a hora noturna de 52'30\" e o adicional.", "CLT, art. 73; decisão D7");
      }
      // intervalo entre jornadas, dia a dia (os horários podem mudar conforme o dia da semana)
      const curtos = [];
      for (let i = 0; i + 1 < days.length; i++) {
        if (!days[i].aberto || off[e][i] || !days[i + 1].aberto || off[e][i + 1]) continue;
        const a = faixa(horarioDia(p, days[i].dw)), b = faixa(horarioDia(p, days[i + 1].dw));
        if (!a || !b) continue;
        const pausa = 1440 + b.ini - a.fim;
        if (pausa < 660 && (days[i].inMonth || days[i + 1].inMonth)) curtos.push(`${ddmm(days[i].d)}→${ddmm(days[i + 1].d)} (${fmtH(pausa)})`);
      }
      if (curtos.length) add("irregular", `${nome(e)}: menos de 11 h entre jornadas`, `${curtos.join("; ")}.`, "CLT, art. 66");
      // horas extras (D11): diária e semanal separadas, sem duplicidade
      const he = horasExtras(ctx, off, e) || [];
      const diasMes = he.flatMap(s => s.porDia).filter(d => days[ctx.days.findIndex(x => x.k === d.k)].inMonth);
      const comExtra = diasMes.filter(d => d.extra > 0);
      if (comExtra.length) {
        const total = comExtra.reduce((t, d) => t + d.extra, 0), maior = Math.max(...comExtra.map(d => d.extra));
        add(maior > 120 ? "irregular" : "atencao", `${nome(e)}: horas extras diárias`,
          `${fmtH(comExtra[0].trabalho)} de trabalho efetivo, acima do limite diário de ${fmtH(comExtra[0].limite)}: ${maior} min a mais por dia em ${comExtra.length} dia${comExtra.length === 1 ? "" : "s"} do mês (total ${fmtH(total)}).` +
          (maior > 120 ? " Passa de 2 h extras por dia." : " Exige acordo de prorrogação ou compensação e pagamento na folha."),
          maior > 120 ? "CLT, art. 59, caput (máximo de 2 h extras por dia)" : "CF, art. 7º, XIII e XVI; CLT, arts. 58 e 59");
      }
      const semanas = he.filter(s => s.semanal > 0);
      if (semanas.length) add("atencao", `${nome(e)}: horas extras semanais`,
        semanas.map(s => `semana de ${ddmm(s.ws)}: ${fmtH(s.semanal)} acima de ${s.limiteSemanal / 60} h`).join("; ") + ". Não inclui as horas já contadas como extras diárias.",
        "CF, art. 7º, XIII (EC 141/2026, art. 6º); CLT, art. 59");
      const duvida = diasMes.filter(d => d.aConfirmar > 0);
      if (duvida.length) add("nverif", `${nome(e)}: jornada acima de 8 h depende da norma coletiva`,
        `${duvida[0].aConfirmar} min por dia, em ${duvida.length} dia${duvida.length === 1 ? "" : "s"}, ficam entre 8h e 8h24. Sem norma coletiva celebrada até 15/12/2026, a cautelar do STF permite até 8h24 sem hora extra; com norma coletiva, vale o que ela fixar. Informe a situação na etapa Escala.`,
        "STF, ADIs 8.041 e 8.042 (cautelar de 12/11/2026); EC 141/2026, art. 6º, I");
    }

    // origem dos limites de jornada usados
    {
      const usados = [...new Map(days.filter(x => x.inMonth).map(x => { const l = limitesJornada(cfg, x.k); return [l.periodo + l.origem, l]; })).values()];
      for (const l of usados) {
        if (l.origem === "coletiva") add("info", "Limites de jornada da norma coletiva", `Diário de ${fmtH(l.diario)} e semanal de ${fmtH(l.semanal)}, conforme a norma coletiva informada. Confira a vigência e a compatibilidade com a EC 141/2026 (art. 3º).`, l.base);
        else if (l.origem === "stf") add("info", "Jornada transitória de até 8h24", "Sem norma coletiva celebrada até 15/12/2026: até 8h24 por dia e 42 h por semana, sem hora extra nos 24 minutos (até 15/12/2027).", l.base);
      }
    }

    // OJ 410 sem o mês anterior: não presume descanso
    const incompletos = [];
    for (let e = 0; e < E; e++) {
      if (ctx.temHistorico[e]) continue;
      let L = 0;
      for (let i = 0; i < days.length && days[i].aberto && !off[e][i]; i++) L++;
      if (L > 0) incompletos.push(`${nome(e)} trabalha ${L} dia${L === 1 ? "" : "s"} seguido${L === 1 ? "" : "s"} desde ${br(days[0].d)}; se trabalhou ${7 - L} ou mais dias imediatamente antes, haverá violação`);
    }
    if (incompletos.length) add("nverif", "OJ 410: validação incompleta no início do período",
      `Sem a escala anterior não dá para saber quantos dias seguidos cada pessoa já vinha trabalhando. ${incompletos.join("; ")}. Gere o mês anterior e use “Montar o mês seguinte” para concluir a verificação.`,
      "CF, art. 7º, XV; OJ 410 da SDI-1 do TST");

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
    return { alertas: al, valido: nIrregular === 0, nIrregular, cnt: c.cnt, gcnt: c.g, funcao: c.funcao, lab, dobras };
  }

  /* ============ resumo e continuidade ============ */
  function resumo(ctx, off, lab) {
    const { cfg, days } = ctx;
    return cfg.equipe.map((p, e) => {
      const r = { p, T: 0, RSR: 0, FG: 0, FER: 0, FC: 0, FE: 0, dom: 0, horas: 0 };
      days.filter(x => x.inMonth).forEach(x => {
        const c = lab[e][x.i]; r[c]++;
        if (c === "T" || c === "FE") { if (x.dw === 6) r.dom++; const jd = jornadaDia(p, x.dw); if (jd) r.horas += jd.eff; }
      });
      r.trab = r.T + r.FE; r.folgas = r.RSR + r.FG + r.FER + r.FC;
      const he = horasExtras(ctx, off, e) || [];
      const dias = he.flatMap(s => s.porDia).filter(d => days.find(x => x.k === d.k).inMonth);
      r.extrasDiarias = dias.reduce((t, d) => t + d.extra, 0);
      r.extrasSemanais = he.reduce((t, s) => t + s.semanal, 0);
      r.extras = r.extrasDiarias + r.extrasSemanais;
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
    jornada, contexto, contar, gerarEscala, rotular, conferir, resumo, historicoDe, rng32, sequenciasLongas, MAX_DIAS_SEGUIDOS,
    PERIODOS_JORNADA, periodoJornada, limitesJornada, horasExtras, folgasMinimas, atribuirDia,
    horarioDia, jornadaDia, ordinariasSemana, DOW_EXT,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
  else root.Motor = Motor;
})(typeof globalThis !== "undefined" ? globalThis : this);
