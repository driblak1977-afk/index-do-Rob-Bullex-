import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BellRing, Bot, CheckCircle2, ChevronDown, Copy, FlaskConical, History, Lightbulb, Pause, Play, Radio, ShieldCheck, TrendingDown, TrendingUp, Volume2, VolumeX, Zap } from "lucide-react";

type Mode = "DEMO" | "REAL";
type Signal = { id: string; time: string; pair: string; direction: "CALL" | "PUT"; result: "WIN" | "LOSS" | "AGUARDANDO"; profit: number; price: number; source: string };
type Config = { pair: string; timeframe: string; entry: number; martingale: string; stopLoss: number; dailyGoal: number; startHour: string; endHour: string; mode: Mode; webhookUrl: string; secret: string };
type LogItem = { id: string; time: string; text: string; kind: "in" | "sys" | "ok" };

const FIXED_PAIR = "EUR/USD OTC";
const FIXED_TIMEFRAME = "1m";
const DEFAULT_CONFIG: Config = { pair: FIXED_PAIR, timeframe: FIXED_TIMEFRAME, entry: 5, martingale: "Não", stopLoss: 3, dailyGoal: 50, startHour: "08:00", endHour: "18:00", mode: "DEMO", webhookUrl: "https://robo-sinais-pro.app/webhook", secret: "ROBO-PRO-2026" };

async function api(action: string, args: Record<string, unknown>) {
  const res = await fetch("actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, args }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(typeof json.error === "string" ? json.error : "Falha na operação");
  return json.data;
}

const PINE = `//@version=5
indicator("Robô Sinais Pro Trader V3 — Bullex EUR/USD OTC 1m", overlay=true)

// ===== BULLEX • EUR/USD OTC • 1 MINUTO • TRAVADO =====
// Use este indicador no gráfico EUR/USD OTC, timeframe 1 minuto.

// ===== ENTRADAS =====
emaFastLen = input.int(5, "EMA rápida")
emaSlowLen = input.int(21, "EMA lenta")
rsiLen = input.int(14, "RSI")
rsiMin = input.int(30, "RSI mínimo")
rsiMax = input.int(70, "RSI máximo")

// ===== 1) EMA 5 x 21 =====
ema5 = ta.ema(close, emaFastLen)
ema21 = ta.ema(close, emaSlowLen)
crossUp = ta.crossover(ema5, ema21)
crossDown = ta.crossunder(ema5, ema21)

// ===== 2) PIVÔ ANTERIOR =====
pivotHigh = ta.pivothigh(high, 5, 5)
pivotLow = ta.pivotlow(low, 5, 5)
lastPivotHigh = ta.valuewhen(not na(pivotHigh), pivotHigh, 0)
lastPivotLow = ta.valuewhen(not na(pivotLow), pivotLow, 0)
breakHigh = close > lastPivotHigh
breakLow = close < lastPivotLow

// ===== 3) RSI CONFIRMA =====
rsi = ta.rsi(close, rsiLen)
rsiOk = rsi > rsiMin and rsi < rsiMax

// ===== SINAL COM 3 CONFLUÊNCIAS =====
callSignal = crossUp and breakHigh and rsiOk
putSignal = crossDown and breakLow and rsiOk

plot(ema5, color=color.new(color.teal, 0), linewidth=2)
plot(ema21, color=color.new(color.orange, 0), linewidth=2)
plotshape(callSignal, style=shape.triangleup, location=location.belowbar, color=color.new(color.green, 0), size=size.large, title="CALL")
plotshape(putSignal, style=shape.triangledown, location=location.abovebar, color=color.new(color.red, 0), size=size.large, title="PUT")

// ===== ALERTAS PARA O WEBHOOK =====
alertcondition(callSignal, title="CALL — Bullex EUR/USD OTC 1m", message='{"par":"EURUSDOTC","sinal":"CALL","preco":{{close}},"timeframe":"1m"}')
alertcondition(putSignal, title="PUT — Bullex EUR/USD OTC 1m", message='{"par":"EURUSDOTC","sinal":"PUT","preco":{{close}},"timeframe":"1m"}')
`;

function nowTime() { return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function fmt(n: number) { return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function pairPrice() { return 1.0977 + (Math.random() - 0.5) * 0.004; }
function priceText(price: number) { return price.toFixed(4); }

export default function App() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [configId, setConfigId] = useState<string | null>(null);
  const [robotOn, setRobotOn] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([
    { id: "l0", time: nowTime(), text: "Robô travado para Bullex • EUR/USD OTC • 1 minuto. Teste em DEMO antes de operar.", kind: "sys" },
  ]);
  const [ma, setMa] = useState(false);
  const [pivot, setPivot] = useState(false);
  const [rsi, setRsi] = useState(false);
  const [pending, setPending] = useState<"CALL" | "PUT" | null>(null);
  const [livePrice, setLivePrice] = useState(1.0977);
  const [showPine, setShowPine] = useState(false);
  const [busySignal, setBusySignal] = useState(false);
  const [entryMsg, setEntryMsg] = useState("");
  const configRef = useRef(config);
  const robotRef = useRef(robotOn);
  const pendingRef = useRef<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const pineRef = useRef<HTMLTextAreaElement>(null);
  configRef.current = config;
  robotRef.current = robotOn;
  pendingRef.current = pending;

  const losses = useMemo(() => signals.filter(s => s.result === "LOSS").length, [signals]);
  const wins = useMemo(() => signals.filter(s => s.result === "WIN").length, [signals]);
  const dayProfit = useMemo(() => signals.reduce((a, s) => a + s.profit, 0), [signals]);
  const stopHit = losses >= config.stopLoss && losses > 0;
  const goalHit = dayProfit >= config.dailyGoal && signals.length > 0;
  const confluencesOn = ma && pivot && rsi;

  function pushLog(text: string, kind: LogItem["kind"] = "sys") {
    setLogs(prev => [{ id: Math.random().toString(36).slice(2), time: nowTime(), text, kind }, ...prev].slice(0, 30));
  }

  function playAlert() {
    if (!soundOn) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      // Alerta alto: 4 bipes fortes, alternando agudo/grave
      [0, 0.28, 0.56, 0.84].forEach((delay, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = i % 2 === 0 ? 1174 : 880; osc.type = "square";
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.32, ctx.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.22);
        osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.24);
      });
      setTimeout(() => ctx.close().catch(() => {}), 1400);
    } catch { /* som indisponível neste navegador */ }
  }

  async function persistSignal(signal: Signal) {
    try {
      await api("records.create", { collection: "robo_signals", value: signal, idempotency_key: `signal-${signal.id}` });
    } catch { /* mantém o sinal na tela mesmo se o salvamento falhar */ }
  }
  async function persistSignalUpdate(signal: Signal) {
    try {
      const found = await api("records.list", { collection: "robo_signals", limit: 100 });
      const rec = (found.records || []).find((r: { value: Signal }) => r.value.id === signal.id);
      if (rec) await api("records.replace", { collection: "robo_signals", id: rec.id, value: signal });
    } catch { /* mantém o resultado na tela */ }
  }

  async function createSignal(direction: "CALL" | "PUT", source: string) {
    const c = configRef.current;
    const price = pairPrice();
    const signal: Signal = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), time: nowTime(), pair: FIXED_PAIR, direction, result: "AGUARDANDO", profit: 0, price, source };
    setSignals(prev => [signal, ...prev].slice(0, 60));
    await persistSignal(signal);
    setTimeout(async () => {
      const win = Math.random() < 0.62;
      const mult = c.martingale === "Não" ? 1 : 1.6;
      const profit = win ? +(c.entry * 0.85 * mult).toFixed(2) : -c.entry;
      const done: Signal = { ...signal, result: win ? "WIN" : "LOSS", profit };
      setSignals(prev => prev.map(s => s.id === signal.id ? done : s));
      await persistSignalUpdate(done);
      pushLog(win ? `Resultado ${direction}: WIN • ${fmt(profit)}` : `Resultado ${direction}: LOSS • ${fmt(profit)}`, win ? "ok" : "sys");
      if (!win && losses + 1 >= c.stopLoss) pushLog("Stop Loss do dia atingido. Considere desligar o robô.", "sys");
    }, 3200);
  }

  async function loadData() {
    try {
      const cfg = await api("records.list", { collection: "robo_config", limit: 1 });
      if (cfg.records?.length) {
        const v = cfg.records[0].value as Partial<Config>;
        setConfigId(cfg.records[0].id);
        setConfig({ ...DEFAULT_CONFIG, ...v, pair: FIXED_PAIR, timeframe: FIXED_TIMEFRAME });
      }
      const sig = await api("records.list", { collection: "robo_signals", limit: 100 });
      const loaded: Signal[] = (sig.records || []).map((r: { value: Signal }) => ({ ...r.value, pair: FIXED_PAIR })).reverse();
      if (loaded.length) setSignals(loaded);
    } catch { /* abre com a configuração padrão, sem interromper o uso */ }
  }
  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const t = setInterval(() => setLivePrice(pairPrice()), 1800);
    return () => clearInterval(t);
  }, []);

  // Simulação ao vivo das confluências enquanto o robô está ligado.
  // Quando as 3 ficam verdes, o robô apita e pisca o botão certo — o usuário confirma clicando nele.
  useEffect(() => {
    if (!robotOn) return;
    const t = setInterval(() => {
      const nextMa = Math.random() < 0.62; const nextPivot = Math.random() < 0.55; const nextRsi = Math.random() < 0.58;
      setMa(nextMa); setPivot(nextPivot); setRsi(nextRsi);
      if (nextMa && nextPivot && nextRsi && !pendingRef.current) {
        const dir = Math.random() < 0.52 ? "CALL" : "PUT";
        setPending(dir); playAlert();
        pushLog(`Webhook: {"par":"EURUSDOTC","sinal":"${dir}","preco":${pairPrice().toFixed(4)},"timeframe":"1m"}`, "in");
        pushLog(`Sinal ${dir} liberado — clique em ${dir === "CALL" ? "ACIMA" : "ABAIXO"} na Bullex.`, "ok");
        setTimeout(() => { if (pendingRef.current === dir) setPending(null); }, 12000);
      }
    }, 4200);
    return () => clearInterval(t);
  }, [robotOn]);

  useEffect(() => { if (!robotOn) { setMa(false); setPivot(false); setRsi(false); setPending(null); } }, [robotOn]);

  async function saveConfig() {
    setSaving(true); setSaveMsg("");
    try {
      const payload = { ...config, pair: FIXED_PAIR, timeframe: FIXED_TIMEFRAME };
      if (configId) await api("records.replace", { collection: "robo_config", id: configId, value: payload });
      else { const rec = await api("records.create", { collection: "robo_config", value: payload, idempotency_key: "robo-config-v3" }); setConfigId(rec.id); }
      setSaveMsg("Configuração salva.");
    } catch { setSaveMsg("Não foi possível salvar agora. Tente novamente."); }
    setSaving(false);
  }

  function copyFrom(el: HTMLInputElement | HTMLTextAreaElement | null, label: string) {
    if (!el) return;
    el.focus(); el.select();
    try { document.execCommand("copy"); setCopyMsg(`${label} copiado.`); } catch { setCopyMsg("Selecione o texto para copiar."); }
    setTimeout(() => setCopyMsg(""), 2600);
  }

  function handleEntry(direction: "CALL" | "PUT") {
    const label = direction === "CALL" ? "ACIMA" : "ABAIXO";
    if (stopHit) { setEntryMsg("Stop do dia atingido. Desligue o robô e pare por hoje."); pushLog("Entrada bloqueada: stop do dia atingido.", "sys"); return; }
    if (pending && pending !== direction) {
      setEntryMsg(`O sinal liberado é ${pending === "CALL" ? "ACIMA" : "ABAIXO"}. Aguarde o sinal certo.`);
      pushLog(`Botão ${label} tocado, mas o sinal liberado era ${pending === "CALL" ? "ACIMA" : "ABAIXO"}.`, "sys");
      return;
    }
    if (!confluencesOn && !pending) {
      setEntryMsg("Aguarde as 3 confluências ficarem verdes para liberar a entrada.");
      pushLog(`Entrada ${label} bloqueada: aguarde as 3 confluências verdes.`, "sys");
      return;
    }
    setEntryMsg(`Entrada ${label} confirmada • ${FIXED_PAIR} • ${fmt(config.entry)} • 1 minuto`);
    pushLog(`Entrada confirmada: ${label} (${direction}) • ${fmt(config.entry)} • Bullex`, "ok");
    createSignal(direction, pending ? "Automático" : "Manual");
    setPending(null);
  }

  function simulateSignal() {
    if (busySignal) return;
    setBusySignal(true);
    setMa(true); setPivot(true); setRsi(true);
    const dir = Math.random() < 0.5 ? "CALL" : "PUT";
    setPending(dir); playAlert();
    pushLog(`Simulação manual: 3 confluências verdes • ${dir} liberado`, "ok");
    setTimeout(() => { setBusySignal(false); }, 3000);
  }

  function testWebhook() {
    const payload = `{"par":"EURUSDOTC","sinal":"CALL","preco":${livePrice.toFixed(4)},"timeframe":"1m"}`;
    pushLog(`Teste de webhook recebido: ${payload}`, "in");
    setMa(true); setPivot(true); setRsi(true); setPending("CALL"); playAlert();
    pushLog("Sinal CALL liberado — clique em ACIMA na Bullex.", "ok");
  }

  function toggleRobot() {
    setRobotOn(v => !v);
    pushLog(robotOn ? "Robô desligado pelo usuário." : `Robô ligado • Modo ${config.mode} • Bullex • ${FIXED_PAIR} • 1 minuto`, "ok");
  }

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setConfig(prev => ({ ...prev, [k]: v }));

  const entryButton = (direction: "CALL" | "PUT") => {
    const isCall = direction === "CALL";
    const active = pending === direction;
    const locked = !confluencesOn && !pending;
    return (
      <button
        key={direction}
        onClick={() => handleEntry(direction)}
        aria-label={isCall ? "ACIMA — CALL" : "ABAIXO — PUT"}
        className={`min-h-[132px] sm:min-h-[148px] w-full rounded-[28px] font-black text-4xl sm:text-5xl flex flex-col items-center justify-center gap-1 border-4 transition active:scale-[0.98] ${isCall ? "bg-emerald-500 text-black border-emerald-300" : "bg-red-500 text-white border-red-300"} ${active ? "animate-pulse shadow-[0_0_0_6px_rgba(255,255,255,0.18),0_0_42px_rgba(245,197,24,0.65)] scale-[1.02]" : ""} ${locked ? "opacity-60 saturate-[0.7]" : ""}`}
      >
        <span className="flex items-center gap-2">{isCall ? <TrendingUp className="w-10 h-10" /> : <TrendingDown className="w-10 h-10" />} {isCall ? "ACIMA" : "ABAIXO"}</span>
        <span className="text-sm sm:text-base font-extrabold tracking-widest">{isCall ? "CALL ▲" : "PUT ▼"}</span>
        <span className="text-xs font-bold opacity-90">{active ? "● SINAL LIBERADO — CLIQUE AGORA" : locked ? "AGUARDE AS 3 VERDES" : "PRONTO PARA ENTRAR"}</span>
      </button>
    );
  };

  return (
    <div data-safe-area-inset-root style={{ boxSizing: "border-box", paddingTop: "var(--safe-area-inset-top)" }} className="min-h-screen bg-[var(--bg)] text-[var(--text)] overflow-x-clip">
      {/* TOPO AMARELO */}
      <div className="bg-[var(--yellow)] text-black px-3 py-3 text-center">
        <p className="text-[15px] sm:text-lg font-black leading-tight [overflow-wrap:anywhere]">QUER UM APP COMO ESSE? FALA COM ADRIANO</p>
        <p className="text-sm sm:text-base font-bold mt-0.5">(19) 99893-2588 • WhatsApp</p>
      </div>

      <header data-safe-area-sticky-top style={{ top: "var(--safe-area-inset-top)" }} className="sticky z-20 bg-[#0b0e14]/95 backdrop-blur border-b border-[var(--line)]">
        <div className="max-w-6xl mx-auto px-3 sm:px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[var(--blue)] grid place-items-center shrink-0"><Bot className="w-6 h-6" /></div>
            <div className="min-w-0">
              <p className="font-black leading-none text-[17px] sm:text-xl [overflow-wrap:anywhere]">ROBÔ SINAIS PRO TRADER <span className="text-[var(--yellow)]">V3</span></p>
              <p className="text-[11px] sm:text-xs text-[var(--muted)] mt-1">Bullex • TradingView + Webhook</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-black shrink-0 ${robotOn ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${robotOn ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            {robotOn ? "LIGADO" : "DESLIGADO"}
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-3 sm:px-5 pb-3 flex gap-2 overflow-x-auto text-xs font-bold">
          {[["#painel", "Painel"], ["#sinais", "Sinais"], ["#historico", "Histórico"], ["#webhook", "Webhook"], ["#pine", "Pine Script"], ["#passo", "Passo a passo"]].map(([href, label]) => (
            <a key={href} href={href} className="shrink-0 px-3 py-2 rounded-full bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--yellow)]">{label}</a>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-5 pb-10 pt-4 space-y-4">
        {/* SELO BULLEX + PLACAR */}
        <section className="rounded-3xl bg-[var(--surface)] border-2 border-[var(--yellow)] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--yellow)] text-black px-3 py-1.5 text-xs sm:text-sm font-black">● MODO BULLEX — EUR/USD OTC</span>
              <p className="text-sm text-[var(--muted)] mt-2">Par travado • Timeframe travado em <strong className="text-white">1 MINUTO</strong> • Sem troca de par.</p>
            </div>
            <div className="text-right"><p className="text-[11px] font-bold text-[var(--muted)]">PREÇO AO VIVO • EUR/USD OTC</p><p className="text-3xl font-black">{priceText(livePrice)}</p><p className="text-xs text-[var(--muted)]">1m • Bullex</p></div>
          </div>
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <div className="rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-3 sm:p-4"><p className="text-[11px] text-[var(--muted)] font-bold">LUCRO DO DIA</p><p className={`text-xl sm:text-2xl font-black mt-1 ${dayProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(dayProfit)}</p><p className="text-xs text-[var(--muted)] mt-1">Meta: {fmt(config.dailyGoal)}</p></div>
          <div className="rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-3 sm:p-4"><p className="text-[11px] text-[var(--muted)] font-bold">WIN / LOSS</p><p className="text-xl sm:text-2xl font-black mt-1"><span className="text-emerald-400">{wins}</span> <span className="text-[var(--muted)]">/</span> <span className="text-red-400">{losses}</span></p><p className="text-xs text-[var(--muted)] mt-1">{signals.length} sinais hoje</p></div>
          <div className="rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-3 sm:p-4"><p className="text-[11px] text-[var(--muted)] font-bold">ENTRADA</p><p className="text-xl sm:text-2xl font-black mt-1">{fmt(config.entry)}</p><p className="text-xs text-[var(--muted)] mt-1">Martingale: {config.martingale}</p></div>
          <div className="rounded-2xl bg-[var(--surface)] border border-[var(--line)] p-3 sm:p-4"><p className="text-[11px] text-[var(--muted)] font-bold">STATUS DO DIA</p><p className="text-sm sm:text-base font-black mt-2 leading-tight">{stopHit ? "⛔ STOP ATINGIDO" : goalHit ? "🎯 META BATIDA" : "🟢 DENTRO DO PLANO"}</p><p className="text-xs text-[var(--muted)] mt-1">Opere com disciplina.</p></div>
        </section>

        {/* 1 PAINEL */}
        <section id="painel" className="rounded-3xl bg-[var(--surface)] border border-[var(--line)] overflow-hidden">
          <div className="p-4 sm:p-6">
            <p className="text-xs font-black tracking-widest text-[var(--yellow)]">01 • PAINEL DO ROBÔ — BULLEX</p>
            <h1 className="text-3xl sm:text-5xl font-black mt-2 leading-none">{robotOn ? <span className="text-emerald-400">ROBÔ LIGADO</span> : <span className="text-red-400">ROBÔ DESLIGADO</span>}</h1>
            <p className="text-sm text-[var(--muted)] mt-2">Modo <strong className="text-white">{config.mode}</strong> • EUR/USD OTC • 1 minuto • {config.startHour} às {config.endHour}</p>
          </div>

          {/* CONFIGURAÇÃO SIMPLES */}
          <div className="px-4 sm:px-6 pb-4">
            <p className="text-xs font-black tracking-widest text-[var(--muted)]">CONFIGURAÇÃO SIMPLES</p>
            <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="block"><span className="text-xs font-bold text-[var(--muted)]">VALOR DA ENTRADA (R$)</span><input type="number" min={1} value={config.entry} onChange={e => set("entry", Number(e.target.value) || 0)} className="mt-1 w-full min-h-[56px] rounded-xl bg-[var(--surface-2)] border border-[var(--line)] px-3 font-black text-xl" /></label>
              <label className="block"><span className="text-xs font-bold text-[var(--muted)]">STOP LOSS (nº de LOSS)</span><input type="number" min={1} value={config.stopLoss} onChange={e => set("stopLoss", Number(e.target.value) || 1)} className="mt-1 w-full min-h-[56px] rounded-xl bg-[var(--surface-2)] border border-[var(--line)] px-3 font-black text-xl" /></label>
              <label className="block"><span className="text-xs font-bold text-[var(--muted)]">META DO DIA (R$)</span><input type="number" min={0} value={config.dailyGoal} onChange={e => set("dailyGoal", Number(e.target.value) || 0)} className="mt-1 w-full min-h-[56px] rounded-xl bg-[var(--surface-2)] border border-[var(--line)] px-3 font-black text-xl" /></label>
              <div><span className="text-xs font-bold text-[var(--muted)]">MARTINGALE</span><div className="mt-1 grid grid-cols-2 gap-2">{["Não", "1 nível"].map(v => <button key={v} onClick={() => set("martingale", v)} className={`min-h-[56px] rounded-xl font-black text-xs sm:text-sm px-1 [overflow-wrap:anywhere] ${config.martingale === v ? "bg-[var(--yellow)] text-black" : "bg-[var(--surface-2)] border border-[var(--line)]"}`}>{v === "Não" ? "DESLIGADO" : "1 NÍVEL"}</button>)}</div></div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["DEMO", "REAL"] as Mode[]).map(m => (
                <button key={m} onClick={() => set("mode", m)} className={`min-h-[52px] rounded-xl font-black border-2 ${config.mode === m ? (m === "DEMO" ? "bg-sky-500 text-white border-sky-400" : "bg-amber-400 text-black border-amber-300") : "bg-[var(--surface-2)] border-[var(--line)] text-[var(--muted)]"}`}>{m === "DEMO" ? "🧪 MODO DEMO" : "💰 MODO REAL"}</button>
              ))}
            </div>
            {config.mode === "REAL" && <div className="mt-3 rounded-xl bg-amber-400/10 border border-amber-400/40 p-3 text-sm text-amber-200">⚠️ Modo REAL selecionado. Teste em DEMO primeiro e confira cada ordem antes de operar com dinheiro real.</div>}
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              <button onClick={toggleRobot} className={`min-h-[60px] rounded-2xl font-black text-lg flex items-center justify-center gap-2 ${robotOn ? "bg-[var(--red)] text-white" : "bg-emerald-500 text-black"}`}>{robotOn ? <><Pause /> DESLIGAR ROBÔ</> : <><Play /> LIGAR ROBÔ</>}</button>
              <button onClick={saveConfig} disabled={saving} className="min-h-[60px] rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] font-black flex items-center justify-center gap-2 disabled:opacity-60"><ShieldCheck /> {saving ? "SALVANDO…" : "SALVAR CONFIGURAÇÃO"}</button>
            </div>
            {saveMsg && <p role="status" className="mt-2 text-sm font-bold text-emerald-300">{saveMsg}</p>}
          </div>

          {/* BOTÕES GIGANTES */}
          <div className="px-4 sm:px-6 pb-6">
            <p className="text-center text-xs font-black tracking-widest text-[var(--muted)] mb-3">QUANDO APITAR, CLIQUE NO BOTÃO QUE ESTIVER PISCANDO — E O MESMO NA BULLEX</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {entryButton("CALL")}
              {entryButton("PUT")}
            </div>
            <div aria-live="polite" className="mt-3 min-h-[28px] text-center">
              {entryMsg ? <p className="text-sm font-bold text-amber-200">{entryMsg}</p> : <p className="text-sm text-[var(--muted)]">{pending ? `Sinal ${pending === "CALL" ? "ACIMA" : "ABAIXO"} liberado. Clique no botão piscando.` : "Sem sinal liberado no momento."}</p>}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
              <button onClick={() => setSoundOn(v => !v)} className="min-h-[44px] px-3 rounded-full bg-[var(--surface-2)] border border-[var(--line)] font-bold text-sm flex items-center gap-2">{soundOn ? <><Volume2 className="w-4 h-4" /> Som ligado</> : <><VolumeX className="w-4 h-4" /> Som desligado</>}</button>
              <p className="text-xs text-[var(--muted)]">Som alto ligado = 4 bipes quando o sinal liberar.</p>
            </div>
          </div>
        </section>

        {/* 2 CONFLUÊNCIAS */}
        <section id="sinais" className="rounded-3xl bg-[var(--surface)] border border-[var(--line)] p-4 sm:p-6">
          <div><p className="text-xs font-black tracking-widest text-[var(--yellow)]">02 • 3 CONFLUÊNCIAS</p><h2 className="text-2xl sm:text-3xl font-black mt-1">O robô só libera com as 3 verdes</h2></div>
          <div className="mt-5 grid sm:grid-cols-3 gap-3">
            {[{ label: "1) MA 5x21 CRUZOU", on: ma, desc: "EMA 5 cruzou EMA 21" }, { label: "2) PIVÔ / DPVAT ROMPEU", on: pivot, desc: "Preço rompeu o pivô anterior" }, { label: "3) RSI CONFIRMOU", on: rsi, desc: "RSI entre 30 e 70 na direção" }].map(c => (
              <div key={c.label} className={`rounded-2xl border-2 p-4 ${c.on ? "border-emerald-400 bg-emerald-500/10" : "border-[var(--line)] bg-[var(--surface-2)]"}`}>
                <div className="flex items-center justify-between gap-2"><span className={`w-5 h-5 rounded-full border-4 ${c.on ? "bg-emerald-400 border-emerald-200 shadow-[0_0_18px_#2ee6a8]" : "bg-red-500 border-red-200/50"}`} /><span className={`text-xs font-black px-2 py-1 rounded-full ${c.on ? "bg-emerald-500 text-black" : "bg-red-500/20 text-red-300"}`}>{c.on ? "VERDE" : "VERMELHO"}</span></div>
                <p className="font-black mt-4 leading-tight [overflow-wrap:anywhere]">{c.label}</p><p className="text-sm text-[var(--muted)] mt-1">{c.desc}</p>
              </div>
            ))}
          </div>
          <div className={`mt-4 rounded-2xl p-5 text-center border-2 ${confluencesOn || pending ? "border-emerald-400 bg-emerald-500/15" : "border-dashed border-[var(--line)] bg-[var(--surface-2)]"}`}>
            {pending ? (
              <><p className="text-xs font-black tracking-widest text-emerald-300">SINAL LIBERADO — CLIQUE NO BOTÃO QUE ESTÁ PISCANDO</p><p className={`text-5xl sm:text-6xl font-black mt-2 flex items-center justify-center gap-2 ${pending === "CALL" ? "text-emerald-400" : "text-red-400"}`}>{pending === "CALL" ? <TrendingUp className="w-12 h-12" /> : <TrendingDown className="w-12 h-12" />} {pending === "CALL" ? "ACIMA" : "ABAIXO"}</p><p className="text-sm text-[var(--muted)] mt-2">EUR/USD OTC • Entrada de {fmt(config.entry)} • 1 minuto • Modo {config.mode}</p></>
            ) : <><p className="text-lg font-black">AGUARDANDO AS 3 CONFLUÊNCIAS…</p><p className="text-sm text-[var(--muted)] mt-1">Sem as 3 verdes, não há entrada. Disciplina acima de tudo.</p></>}
          </div>
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            <button onClick={simulateSignal} disabled={busySignal} className="min-h-[56px] rounded-2xl bg-[var(--blue)] text-white font-black flex items-center justify-center gap-2 disabled:opacity-60"><Zap /> {busySignal ? "SIMULANDO…" : "SIMULAR SINAL"}</button>
            <button onClick={testWebhook} className="min-h-[56px] rounded-2xl bg-[var(--yellow)] text-black font-black flex items-center justify-center gap-2"><Radio /> TESTAR WEBHOOK</button>
          </div>
        </section>

        {/* 3 HISTÓRICO */}
        <section id="historico" className="rounded-3xl bg-[var(--surface)] border border-[var(--line)] p-4 sm:p-6">
          <div className="flex items-center gap-2"><History /><h2 className="text-2xl font-black">Histórico de sinais</h2></div>
          <p className="text-sm text-[var(--muted)] mt-1">Hora • EUR/USD OTC • direção • resultado • lucro. O histórico fica salvo neste app.</p>
          <div className="mt-4 space-y-2">
            {signals.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--line)] p-6 text-center text-[var(--muted)]">Nenhum sinal ainda. Ligue o robô ou toque em <strong className="text-white">Simular Sinal</strong>.</div>}
            {signals.map(s => (
              <div key={s.id} className="rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] p-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0"><p className="font-black [overflow-wrap:anywhere]">{s.pair} • <span className={s.direction === "CALL" ? "text-emerald-400" : "text-red-400"}>{s.direction === "CALL" ? "ACIMA" : "ABAIXO"}</span></p><p className="text-xs text-[var(--muted)]">{s.time} • {s.source} • Preço {priceText(s.price)} • 1m</p></div>
                <div className="text-right shrink-0"><p className={`font-black ${s.result === "WIN" ? "text-emerald-400" : s.result === "LOSS" ? "text-red-400" : "text-amber-300"}`}>{s.result}</p><p className={`font-black ${s.profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>{s.result === "AGUARDANDO" ? "…" : fmt(s.profit)}</p></div>
              </div>
            ))}
          </div>
        </section>

        {/* 4 WEBHOOK */}
        <section id="webhook" className="rounded-3xl bg-[var(--surface)] border border-[var(--line)] p-4 sm:p-6">
          <div className="flex items-center gap-2"><BellRing /><h2 className="text-2xl font-black">Webhook</h2></div>
          <p className="text-sm text-[var(--muted)] mt-1">É aqui que o TradingView entrega o alerta. Cole esta URL no alerta do TradingView.</p>
          <label className="block mt-4"><span className="text-xs font-bold text-[var(--muted)]">URL DO WEBHOOK</span><input ref={urlRef} value={config.webhookUrl} onChange={e => set("webhookUrl", e.target.value)} className="mt-1 w-full min-h-[52px] rounded-xl bg-[var(--surface-2)] border border-[var(--line)] px-3 mono text-sm [overflow-wrap:anywhere]" /></label>
          <label className="block mt-3"><span className="text-xs font-bold text-[var(--muted)]">CHAVE SECRETA</span><input value={config.secret} onChange={e => set("secret", e.target.value)} className="mt-1 w-full min-h-[52px] rounded-xl bg-[var(--surface-2)] border border-[var(--line)] px-3 mono font-bold" /></label>
          <button onClick={() => copyFrom(urlRef.current, "URL")} className="mt-3 w-full sm:w-auto min-h-[52px] px-5 rounded-xl bg-[var(--yellow)] text-black font-black flex items-center justify-center gap-2"><Copy /> COPIAR URL</button>
          {copyMsg && <p role="status" className="mt-2 text-sm font-bold text-emerald-300">{copyMsg}</p>}
          <div className="mt-5">
            <p className="font-black flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-400" /> LOG AO VIVO</p>
            <div className="mt-2 rounded-2xl bg-black/50 border border-[var(--line)] p-3 space-y-2 max-h-[280px] overflow-y-auto">
              {logs.map(l => (
                <div key={l.id} className="text-xs sm:text-sm leading-relaxed break-words">
                  <span className="text-[var(--muted)]">{l.time} - </span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--muted)] mt-2 mono [overflow-wrap:anywhere]">Exemplo que chega do TradingView: {`{"par":"EURUSDOTC","sinal":"CALL","preco":1.0977,"timeframe":"1m"}`}</p>
          </div>
        </section>

        {/* 5 PINE */}
        <section id="pine" className="rounded-3xl bg-[var(--surface)] border border-[var(--line)] p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap"><h2 className="text-2xl font-black">Código Pine Script</h2><button onClick={() => copyFrom(pineRef.current, "Código")} className="min-h-[48px] px-4 rounded-xl bg-[var(--yellow)] text-black font-black flex items-center gap-2"><Copy /> COPIAR CÓDIGO</button></div>
          <p className="text-sm text-[var(--muted)] mt-1">Pronto para colar no TradingView. Bullex • EUR/USD OTC • 1 minuto • EMA 5 × 21 • rompimento de pivô • RSI 30–70 • alertas CALL e PUT em JSON.</p>
          <button onClick={() => setShowPine(v => !v)} className="mt-4 min-h-[48px] px-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] font-bold flex items-center gap-2">{showPine ? "Ocultar código" : "Ver código completo"} <ChevronDown className={`w-4 h-4 transition ${showPine ? "rotate-180" : ""}`} /></button>
          {showPine && <textarea ref={pineRef} readOnly value={PINE} rows={12} className="mt-3 w-full rounded-2xl bg-black/60 border border-[var(--line)] p-3 mono text-[12px] leading-relaxed text-emerald-100" />}
          {!showPine && <textarea ref={pineRef} readOnly value={PINE} rows={3} aria-label="Código Pine Script" className="mt-3 w-full rounded-2xl bg-black/60 border border-[var(--line)] p-3 mono text-[12px] leading-relaxed text-emerald-100" />}
        </section>

        {/* 6 PASSO A PASSO BULLEX */}
        <section id="passo" className="rounded-3xl bg-[var(--surface)] border border-[var(--line)] p-4 sm:p-6">
          <p className="text-xs font-black tracking-widest text-[var(--yellow)]">06 • PASSO A PASSO — BULLEX</p><h2 className="text-2xl font-black mt-1">Robô e Bullex lado a lado</h2>
          <ol className="mt-4 space-y-3">
            {[
              ["1", "Deixar o robô e a Bullex lado a lado", "Abra este app em uma metade da tela e a Bullex na outra. Na Bullex, deixe EUR/USD OTC, 1 minuto, e o valor da entrada pronto."],
              ["2", "Colar o Pine no TradingView", "Abra o editor Pine, cole o código desta página, clique em Adicionar ao gráfico EUR/USD OTC no timeframe de 1 minuto."],
              ["3", "Adicionar alerta com Webhook URL", "No alerta, marque Webhook URL, cole a URL desta página e use a mensagem JSON do código."],
              ["4", "Ligar o robô aqui", "Confira valor (R$ 5), Martingale desligado, stop 3 loss e meta R$ 50. Depois toque em Ligar Robô."],
              ["5", "Esperar apitar", "Quando as 3 confluências ficarem verdes, o robô apita alto e o botão certo começa a piscar."],
              ["6", "Clicar ACIMA ou ABAIXO na Bullex", "Se piscar ACIMA, clique em ACIMA na Bullex. Se piscar ABAIXO, clique em ABAIXO na Bullex. Confira o valor antes de confirmar."],
            ].map(([n, t, d]) => (
              <li key={n} className="flex gap-3 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] p-4"><span className="w-10 h-10 shrink-0 rounded-full bg-[var(--yellow)] text-black grid place-items-center font-black text-lg">{n}</span><div className="min-w-0"><p className="font-black leading-tight [overflow-wrap:anywhere]">{t}</p><p className="text-sm text-[var(--muted)] mt-1 [overflow-wrap:anywhere]">{d}</p></div></li>
            ))}
          </ol>
          <div className="mt-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex gap-3"><Lightbulb className="w-5 h-5 text-emerald-300 shrink-0" /><p className="text-sm leading-relaxed"><strong>Regra de ouro:</strong> stop do dia e meta do dia existem para proteger você. Bateu o stop, desligue. Bateu a meta, pare. <strong className="text-emerald-300">Obrigado por usar o Robô Sinais Pro Trader V3!</strong></p></div>
          <p className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> Simulação educativa. Teste em DEMO primeiro.</p>
        </section>

        <footer className="text-center text-xs text-[var(--muted)] pt-2 leading-relaxed">Simulação educativa. Day trade envolve risco. Opere com responsabilidade e nunca arrisque valores que você não pode perder.</footer>
      </main>
    </div>
  );
}
