import { createClient } from 'jsr:@supabase/supabase-js@2';
// Vybra · comprobador de inscripciones (v6)
// Lee la web de inscripción de cada prueba y extrae: estado (abierta/abre/cerrada/agotada/no_disponible),
// fecha y hora de apertura, fecha de cierre y la web OFICIAL de inscripción (si la fuente es un agregador).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const MES: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, gen: 1, gener: 1, xan: 1, xaneiro: 1, january: 1,
  feb: 2, febrero: 2, febrer: 2, febreiro: 2, february: 2,
  mar: 3, marzo: 3, 'març': 3, marc: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5, maig: 5, maio: 5,
  jun: 6, junio: 6, juny: 6, 'xuño': 6, june: 6,
  jul: 7, julio: 7, juliol: 7, xullo: 7, july: 7,
  ago: 8, agosto: 8, agost: 8, aug: 8, august: 8,
  sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, setembre: 9, setembro: 9, september: 9,
  oct: 10, octubre: 10, outubro: 10, october: 10,
  nov: 11, noviembre: 11, novembre: 11, novembro: 11, november: 11,
  dic: 12, diciembre: 12, des: 12, desembre: 12, dec: 12, decembro: 12, december: 12,
};
const MRE = Object.keys(MES).sort((a, b) => b.length - a.length).join('|');
const p2 = (n: number) => String(n).padStart(2, '0');
const madridToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
function clean(h: string) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '. ').replace(/<\/(p|li|div|h\d|tr)>/gi, '. ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ').replace(/&ccedil;/g, 'ç').replace(/&ordm;/g, 'º')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
// Fecha (día, mes, año opcional) -> YYYY-MM-DD, siempre antes o igual que el día de la prueba y como mucho 13 meses antes
function toDate(d: number, m: number, y: number | null, race: string) {
  if (!m || d < 1 || d > 31) return null;
  if (y && y < 100) y += 2000;
  if (y) { const s = y + '-' + p2(m) + '-' + p2(d); return s <= race ? s : null; }
  const ry = +race.slice(0, 4);
  for (const yy of [ry, ry - 1]) { const s = yy + '-' + p2(m) + '-' + p2(d); if (s <= race) return s; }
  return null;
}
const DTXT = `(\\d{1,2})(?:\\s*(?:de|d'|d’)?\\s*)(${MRE})\\.?(?:\\s*(?:de|del|,)?\\s*(\\d{4}))?`;
const DNUM = `(\\d{1,2})[\\/\\.-](\\d{1,2})[\\/\\.-](\\d{2,4})`;
function dateAt(s: string, race: string): string | null {
  let m = s.match(new RegExp('^\\s*' + DTXT, 'i'));
  if (m) return toDate(+m[1], MES[m[2].toLowerCase()], m[3] ? +m[3] : null, race);
  m = s.match(new RegExp('^\\s*' + DNUM));
  if (m) return toDate(+m[1], +m[2], +m[3], race);
  return null;
}
const KW = `(?:inscripci[oó]n(?:es)?|inscripcions|inscripcio|inscrici[oó]ns|inscriciones|plazo|termini|registration)`;
const WD = `(?:(?:el|al|a|la|dia|día|del|fins al|fins el|hasta el)\\s+)*(?:(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge)\\s*,?\\s*)?(?:(?:el|dia|día)\\s+)?`;
type R = { struct?: boolean; conflict?: boolean; state?: string; open?: string; openTime?: string; close?: string; closeTxt?: string; openTxt?: string; official?: string; why?: string[] };
function parseText(t: string, race: string, r: R) {
  const why = r.why || (r.why = []);
  // "del 10 de septiembre (de 2026) al 10 de noviembre (de 2026)" cerca de inscripción
  const rng = new RegExp(KW + `[^.]{0,120}?(?:del|desde el|des del|a partir del?|entre el|from|inicio\\s*:?)\\s+` + WD + `(${DTXT}|${DNUM})` + `[^.]{0,60}?(?:al|hasta el|fins al|fins el|y el|to|fin\\s*:?)\\s+` + WD + `(${DTXT}|${DNUM})`, 'i');
  let m = t.match(rng);
  if (m) {
    const parts = m[0].match(new RegExp(`(${DTXT}|${DNUM})`, 'gi')) || [];
    const d1 = parts[0] ? dateAt(parts[0], race) : null, d2 = parts[parts.length - 1] ? dateAt(parts[parts.length - 1], race) : null;
    if (d1 && d2 && d1 <= d2) { r.open = r.open || d1; r.close = r.close || d2; r.closeTxt = m[0].slice(0, 180); why.push('rango'); }
  }
  // cierre: "... inscripción ... hasta / fins / cierra / finaliza / acaba / límite ... <fecha>"
  if (!r.close) {
    const re = new RegExp(KW + `[^.]{0,140}?(?:hasta|fins|cierr[\\wáéíóúàèòçñ]*|tanc[\\wáéíóúàèòçñ]*|finaliz[\\wáéíóúàèòçñ]*|acab[\\wáéíóúàèòçñ]*|termin[\\wáéíóúàèòçñ]*|l[ií]mit[\\wáéíóúàèòçñ]*|deadline|close[\\wáéíóúàèòçñ]*)\\s*(?:de\\s+inscripci[oó]n(?:es)?\\s*)?[:\\-]?\\s*` + WD + `(${DTXT}|${DNUM})`, 'i');
    m = t.match(re);
    if (m) { const d = dateAt(m[1], race); if (d) { r.close = d; r.closeTxt = m[0].slice(0, 180); why.push('hasta'); } }
  }
  if (!r.close) {
    const re = new RegExp(`(?:cierre|fecha l[ií]mite|tancament|fin)\\s+(?:de\\s+|d['’]\\s*)?(?:las?\\s+)?` + KW + `\\s*[:\\-]?\\s*` + WD + `(${DTXT}|${DNUM})`, 'i');
    m = t.match(re);
    if (m) { const d = dateAt(m[1], race); if (d) { r.close = d; r.closeTxt = m[0].slice(0, 180); why.push('cierre'); } }
  }
  // apertura
  if (!r.open) {
    const re = new RegExp(KW + `[^.]{0,80}?(?:se\\s+)?(?:abr[\\wáéíóúàèòçñ]*|obr[\\wáéíóúàèòçñ]*|comienz[\\wáéíóúàèòçñ]*|empiez[\\wáéíóúàèòçñ]*|inici[\\wáéíóúàèòçñ]*|a partir del?|desde el|des del|disponibles? (?:a partir del?|desde el))\\s*` + WD + `(${DTXT}|${DNUM})(?:[^.]{0,25}?(\\d{1,2})[:.h](\\d{2}))?`, 'i');
    m = t.match(re);
    if (m) { const d = dateAt(m[1], race); if (d) { r.open = d; r.openTxt = m[0].slice(0, 180); if (m[m.length - 2] && m[m.length - 1]) r.openTime = p2(+m[m.length - 2]) + ':' + m[m.length - 1]; why.push('abre'); } }
  }
  // agotadas
  if (new RegExp(`(?:${KW}|plazas|dorsales|places|dorsals)[^.]{0,40}?(?:agotad|esgotad|complet[ao]s?\\b|sold out|cubiert)`, 'i').test(t) || /(?:sold out|agotad[ao]s? (?:las )?(?:inscripciones|plazas|dorsales))/i.test(t)) { r.state = r.state || 'agotada'; why.push('agotada'); }
  if (!r.state && new RegExp(`${KW}\\s+(?:cerradas|tancades|cerrada|tancada|closed)`, 'i').test(t)) { r.state = 'cerrada'; why.push('txt-cerrada'); }
  if (!r.state && new RegExp(`${KW}\\s+(?:abiertas|obertes|abierta|oberta|open)\\b`, 'i').test(t)) { r.state = 'abierta'; why.push('txt-abierta'); }
  // señales contradictorias en el texto (p. ej. «abiertas» y «agotadas» a la vez): no te fíes
  const sAb = new RegExp(`${KW}\\s+(?:abiertas|obertes|abierta|oberta|open)\\b`, 'i').test(t), sCe = new RegExp(`${KW}\\s+(?:cerradas|tancades|cerrada|tancada|closed)`, 'i').test(t);
  if (sAb && (sCe || r.state == 'agotada')) { r.conflict = true; why.push('conflicto'); }
}
function sportmaniacs(h: string, t: string, race: string, today: string, r: R) {
  const bi = t.search(/Inscripciones\s+\S[^]{0,80}?\d{2}\/\d{2}\/\d{4}/);
  const blk = bi >= 0 ? t.slice(bi, (t.indexOf('Justificante', bi) > 0 ? t.indexOf('Justificante', bi) : bi + 1500)) : '';
  const nIns = (h.match(/<span>Inscribirme<\/span>/g) || []).length;
  const open = [...blk.matchAll(new RegExp(`Abren?\\s+el\\s+(\\d{1,2})\\s+(${MRE})\\.?\\s*(?:(\\d{4})\\s*)?-?\\s*(\\d{1,2}:\\d{2})?`, 'gi'))];
  const nCer = (blk.match(/\bCerrada\b/g) || []).length, nNo = (blk.match(/No disponible/g) || []).length, nAg = (blk.match(/Agotad/gi) || []).length;
  r.struct = nIns > 0 || open.length > 0 || nAg > 0 || nCer > 0 || nNo > 0;
  if (nIns > 0) r.state = 'abierta';
  else if (open.length) {
    r.state = 'abre';
    for (const m of open) { const d = toDate(+m[1], MES[m[2].toLowerCase()], m[3] ? +m[3] : null, race); if (d && d >= today && (!r.open || d < r.open)) { r.open = d; r.openTime = m[4] || undefined; } }
  } else if (nAg > 0 && nNo == 0) r.state = 'agotada';
  else if (nCer > 0 && nNo == 0) r.state = 'cerrada';
  else if (nNo > 0) r.state = 'no_disponible';
  (r.why ||= []).push('sm:' + [nIns, open.length, nCer, nNo, nAg].join('/'));
}
function haid(h: string, base: string, r: R) {
  // la web de inscripción del organizador está en el JSON-LD (offers[].url)
  for (const m of h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const offs: any[] = [].concat(j.offers || [], ...((j.subEvent || []).map((x: any) => x.offers || [])));
      for (const o of offs) if (o && o.url && /^https?:/.test(o.url) && !/haid\.app/.test(o.url)) { r.official = o.url; return; }
    } catch { /* nada */ }
  }
  void base;
}
async function scanOne(u: string, race: string, today: string) {
  const r: R = { why: [] };
  const res = await fetch(u, { redirect: 'follow', headers: { 'user-agent': UA, 'accept-language': 'es-ES,es;q=0.9' }, signal: AbortSignal.timeout(15000) });
  const buf = new Uint8Array(await res.arrayBuffer());
  let cs = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1] || '';
  if (!cs) { const head = new TextDecoder('latin1').decode(buf.slice(0, 4000)); cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8'; }
  let h: string; try { h = new TextDecoder(cs.toLowerCase()).decode(buf); } catch { h = new TextDecoder('utf-8').decode(buf); }
  const t = clean(h);
  const fin = res.url;
  if (/sportmaniacs\.com/.test(fin)) sportmaniacs(h, t, race, today, r);
  if (/haid\.app/.test(fin)) haid(h, fin, r);
  parseText(t, race, r);
  return { status: res.status, final: fin, r };
}
Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data } = await sb.from('private_kv').select('v').eq('k', 'ingest_token').single();
  const b = await req.json().catch(() => ({}));
  if (!data || b.token !== data.v) return new Response('forbidden', { status: 403 });
  const today = madridToday();
  let q = sb.from('events').select('id,dt,url,reg_url,cierre,reg_open,closed,reg_state').gte('dt', today).order('dt');
  if (b.ids) q = q.in('id', b.ids); else q = q.range(b.from || 0, (b.from || 0) + (b.n || 25) - 1);
  const { data: ev } = await q;
  const out: any[] = [];
  await Promise.all((ev || []).map(async (e: any) => {
    const u = b.useUrl ? (e.url || e.reg_url) : (e.reg_url || e.url); if (!u || !/^https?:/.test(u)) { out.push({ id: e.id, skip: 'sin web' }); return; }
    try {
      const { status, final, r } = await scanOne(u, e.dt, today);
      // si la fuente es un agregador y enlaza a la web oficial, se lee también la oficial
      let off: any = null;
      if (r.official) { try { off = await scanOne(r.official, e.dt, today); } catch { /* nada */ } }
      const R = { ...r, ...(off && off.status == 200 ? Object.fromEntries(Object.entries(off.r).filter(([k, v]) => v && k != 'why')) : {}) } as R;
      if (!R.close && r.close) R.close = r.close;
      if (R.close && /devoluci|cesi[oó]n|reembols|cambio de|dorsal a otr/i.test((off && off.r.closeTxt) || r.closeTxt || '')) { R.close = undefined; }
      const upd: any = { reg_checked: new Date().toISOString(), reg_src: final.slice(0, 300) };
      if (status == 200) {
        if (off && off.status == 200 && off.final && !/haid\.app/.test(off.final)) upd.reg_url = off.final;
        if (R.close) upd.cierre = R.close;
        if (R.open) { upd.reg_open = R.open; upd.reg_open_time = R.openTime || null; }
        let st = R.state;
        if (!st && R.close) st = R.close < today ? 'cerrada' : (R.open && R.open > today ? 'abre' : 'abierta');
        if (!st && R.open) st = R.open > today ? 'abre' : null;
        if (R.close && R.close < today && st != 'agotada') st = 'cerrada';
        if (st == 'abre' && R.open && R.open <= today) st = 'abierta';
        // --- Anti-errores: solo se pisan datos cuando la lectura es fiable ---
        const dateClosed = !!(R.close && R.close < today);           // determinista: la fecha ya pasó
        const reliable = dateClosed || !!R.struct || !!(off && off.r && off.r.struct);
        if (R.conflict || (r as any).conflict) st = (dateClosed ? 'cerrada' : undefined) as any;
        if (R.close && R.open && R.close < R.open) { delete upd.cierre; delete upd.reg_open; delete upd.reg_open_time; }
        if (R.close && R.close < today && R.close < new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)) delete upd.cierre; // fecha absurda
        // cerrar/agotar solo con confirmación: fecha pasada, plataforma estructurada o 2 lecturas seguidas iguales
        let prevSt: string | null = null;
        { const { data: pa } = await sb.from('reg_audit').select('parsed').eq('id', e.id).maybeSingle(); prevSt = pa?.parsed?.upd?.pending || pa?.parsed?.upd?.reg_state || null; }
        if ((st == 'cerrada' || st == 'agotada') && !reliable && prevSt != st && e.reg_state != st) { upd.pending = st; st = undefined; }
        if (st) upd.reg_state = st;
        if (st == 'cerrada' || st == 'agotada') upd.closed = true; else if (st == 'abierta' || st == 'abre') upd.closed = false;
        upd.checked = today;
      }
      if (b.apply && status == 200) { const { pending, ...clean_ } = upd; void pending; const { error } = await sb.from('events').update(clean_).eq('id', e.id); if (error) upd.err = error.message; }
      await sb.from('reg_audit').upsert({ id: e.id, url: u, final_url: final, status, parsed: { r, off: off ? { st: off.status, final: off.final, r: off.r } : null, upd }, at: new Date().toISOString() });
      out.push({ id: e.id, status, upd });
    } catch (er) { out.push({ id: e.id, error: String(er).slice(0, 120) }); }
  }));
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
});
