// OiMira Pagos — facturas con vencimiento/recurrencia + creditos con abonos.
var C = window.PG_CONFIG;
/* ===== LECTURA CON COPIA (2026-09-24) — regla del ecosistema: sin internet todo sigue funcionando =====
   Cada lectura (GET a /rest/v1/, y las RPC de solo lectura indicadas) que llega bien se guarda en Cache Storage.
   Sin señal (o servidor 5xx) se devuelve la última copia y aparece una franja amarilla con la fecha.
   El nombre de la caché NO empieza con el prefijo de ningún service worker del sitio (GitHub Pages comparte origen). */
function crearFetchConCopia(CACHE_DATOS, rpcLectura) {
  rpcLectura = rpcLectura || [];
  var desde = 0;
  function pintar() {
    var b = document.getElementById("copiaBanner");
    if (!b) { b = document.createElement("div"); b.id = "copiaBanner"; b.style.cssText = "position:sticky;top:0;z-index:9999;background:#fef3c7;color:#92400e;font-size:12.5px;padding:6px 12px;text-align:center;border-bottom:1px solid #fcd34d;display:none"; document.body.prepend(b); }
    if (!desde) { b.style.display = "none"; return; }
    var d = new Date(desde);
    b.textContent = "📴 Sin señal · estás viendo lo guardado en este equipo (" + d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }) + ") — se actualiza solo al volver el internet. Para guardar cambios hace falta señal.";
    b.style.display = "block";
  }
  window.addEventListener("online", function () { desde = 0; pintar(); });
  return async function (input, init) {
    init = init || {};
    var url = typeof input === "string" ? input : input.url;
    var m = (init.method || (input && input.method) || "GET").toUpperCase();
    var esRpcLectura = m === "POST" && rpcLectura.some(function (n) { return url.indexOf("/rest/v1/rpc/" + n) >= 0; });
    var esLectura = ((m === "GET" || m === "HEAD") && url.indexOf("/rest/v1/") >= 0) || esRpcLectura;
    if (!esLectura || !("caches" in window)) return fetch(input, init);
    var clave = url + (url.indexOf("?") >= 0 ? "&" : "?") + "__m=" + m + (esRpcLectura ? "&__b=" + encodeURIComponent(String(init.body || "")) : "");
    async function copia(motivo) {
      try {
        var hit = await (await caches.open(CACHE_DATOS)).match(clave);
        if (hit) { var t = Number(hit.headers.get("x-guardado") || Date.now()); desde = desde ? Math.min(desde, t) : t; pintar(); return hit; }
      } catch (e) { /* */ }
      if (motivo instanceof Response) return motivo;
      throw motivo;
    }
    var r;
    try {
      if (!navigator.onLine) throw new TypeError("Failed to fetch (sin señal)");
      var ctl = new AbortController(); var tope = setTimeout(function () { ctl.abort(); }, 12000);
      try { r = await fetch(input, Object.assign({}, init, { signal: init.signal || ctl.signal })); } finally { clearTimeout(tope); }
    } catch (e) { return copia(e); }
    if (r.status >= 500) return copia(r);
    if (r.ok) {
      try {
        var h = new Headers(r.headers); h.set("x-guardado", String(Date.now()));
        var cp = new Response(await r.clone().arrayBuffer(), { status: r.status, statusText: r.statusText, headers: h });
        caches.open(CACHE_DATOS).then(function (c) { return c.put(clave, cp); }).catch(function () {});
      } catch (e) { /* sin espacio: seguir sin copia */ }
      if (desde) { desde = 0; pintar(); }
    }
    return r;
  };
}
var sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { global: { fetch: crearFetchConCopia("datos-pagos-v1", ["pagos_datos"]) } });
var $ = function(s){ return document.querySelector(s); };
document.getElementById("ver").textContent = C.APP_VERSION;

/* ===== ENTRADA CON PIN (2026-09-29) =====
   Las tablas ya no se leen directo: todo pasa por funciones del servidor que exigen la sesión (token) que da pagos_login.
   Entra quien tenga el permiso "OiMira Pagos" (config.fitmassa.com → 👥 Accesos) o el dueño. La sesión dura 30 días en este equipo.
   Sin señal: quien ya entró ve la última copia guardada. */
var SES_KEY = "pagos_sesion_v1";
var SES = null;
try { SES = JSON.parse(localStorage.getItem(SES_KEY) || "null"); } catch(e) { SES = null; }
if(SES && !(SES.hasta > Date.now())) SES = null;
function tok(){ return SES ? SES.token : null; }
function mostrarGate(txt){
  $("#pinGate").classList.remove("hidden"); $("#pinMsg").textContent = txt || ""; $("#pinInput").value = ""; setTimeout(function(){ $("#pinInput").focus(); }, 50);
}
function sesionFuera(txt){ SES = null; try { localStorage.removeItem(SES_KEY); } catch(e){} mostrarGate(txt); }
function entrar(){
  $("#pinGate").classList.add("hidden");
  $("#quien").textContent = "👤 " + String(SES.nombre || "").split(" ")[0];
  cargarPagos();
}
async function rpcP(nombre, args){
  var r = await sb.rpc(nombre, Object.assign({ p_token: tok() }, args || {}));
  if(r.error && /Sesión vencida|Sin permiso/i.test(r.error.message || "")) sesionFuera(r.error.message);
  return r;
}
var DATOS = { facturas: [], creditos: [], abonos: [] };
async function cargarDatos(){
  var r = await rpcP("pagos_datos");
  if(r.error) return r.error;
  DATOS = r.data || DATOS; return null;
}
$("#pinEntrar").onclick = async function(){
  var pin = $("#pinInput").value.trim();
  if(!/^[0-9]{4,10}$/.test(pin)) return ($("#pinMsg").textContent = "PIN incorrecto");
  if(!navigator.onLine) return ($("#pinMsg").textContent = "Sin señal: para entrar la primera vez hace falta internet.");
  $("#pinEntrar").disabled = true; $("#pinEntrar").textContent = "Verificando…";
  try {
    var r = await sb.rpc("pagos_login", { p_pin: pin });
    if(r.error) throw r.error;
    if(!r.data || !r.data.ok) { $("#pinMsg").textContent = "PIN incorrecto o sin permiso para OiMira Pagos"; $("#pinInput").value = ""; return; }
    SES = { token: r.data.token, nombre: r.data.nombre, hasta: Date.now() + 29 * 86400000 };
    try { localStorage.setItem(SES_KEY, JSON.stringify(SES)); } catch(e){}
    entrar();
  } catch(e) { $("#pinMsg").textContent = errRed(e); }
  finally { $("#pinEntrar").disabled = false; $("#pinEntrar").textContent = "Entrar"; }
};
$("#pinInput").addEventListener("keydown", function(e){ if(e.key === "Enter") $("#pinEntrar").click(); });
$("#salir").onclick = function(e){ e.preventDefault(); if(confirm("¿Salir de OiMira Pagos en este equipo?")) sesionFuera(""); };

// Fecha local Venezuela (UTC-4) — leccion aprendida: nunca UTC para fechas de negocio.
function hoyVE(){ return new Date(Date.now() - 14400000).toISOString().slice(0,10); }
function addDias(iso, n){ var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); }
function addMes(iso){ var d = new Date(iso + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0,10); }
function fmtD(iso){ var p = iso.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
function fmtM(m, mo){ return (mo || "R$") + " " + Number(m).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function msg(id, t, err){ var el = $("#" + id); el.textContent = t || ""; el.className = "msg " + (err ? "err" : "ok"); if(t) setTimeout(function(){ el.textContent = ""; }, 4000); }
function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }


/* ===== Interconexion con la caja OiMira ===== */
var CANALES_CAJA = {
  "R$": [["Efectivo","💵 Efectivo R$"],["PIX","🇧🇷 PIX"],["PuntoBr","💳 Punto Br"]],
  "Bs": [["PagoMovil","📲 Pago Móvil"],["BanescoPos","💳 Banesco POS"],["BsEfectivo","💵 Bs efectivo"]],
  "USD": [["USD","💵 USD"]]
};
// Pregunta si el pago salio de la caja y de que canal. Devuelve el canal (texto) o null (otro dinero).
// 2026-09-24: ya NO crea el retiro aparte: el retiro y el abono se hacen juntos en el servidor
// (pago_pagar_factura / pago_pagar_credito, una sola transaccion). Antes, si el abono fallaba despues
// del retiro (sin senal, factura ya pagada...), quedaba el dinero descontado de la caja sin el pago.
function elegirCanalCaja(moeda, msgId){
  if(!confirm("¿Este pago salió de la CAJA OiMira?\n\nAceptar = SÍ (se descuenta de la caja)\nCancelar = No (se pagó con otro dinero)")) return null;
  var ops = CANALES_CAJA[moeda] || [];
  var menu = ops.map(function(o,i){ return (i+1) + ". " + o[1]; }).join("\n");
  var sel = prompt("¿De qué caja salió?\n\n" + menu + "\n\nEscribe el número:", "1");
  if(sel === null) return undefined; // cancelado: no se registra nada
  var idx = parseInt(sel, 10) - 1;
  if(!(idx >= 0 && idx < ops.length)){ msg(msgId, "Canal inválido — no se registró nada. Vuelve a intentarlo.", true); return undefined; }
  return ops[idx][0];
}
function errRed(e){ var m = String((e && (e.message || e)) || ""); return !navigator.onLine || /fetch|network|load failed/i.test(m) ? "📵 Sin conexión: no se registró nada. Inténtalo cuando vuelva la señal." : m; }
/* ===== Tabs ===== */
document.getElementById("tabs").addEventListener("click", function(e){
  var b = e.target.closest("button"); if(!b) return;
  document.querySelectorAll("#tabs button").forEach(function(x){ x.classList.toggle("act", x === b); });
  document.querySelectorAll("main > section").forEach(function(s){ s.classList.add("hidden"); });
  $("#t-" + b.dataset.t).classList.remove("hidden");
  if(b.dataset.t === "pagos") cargarPagos(); else cargarCreditos();
});

/* ===== PAGOS ===== */
var EDIT_ID = null;
$("#pVence").value = hoyVE();

$("#pGuardar").onclick = async function(){
  var titulo = $("#pTitulo").value.trim();
  if(!titulo) return msg("pMsg", "Escribe qué se paga.", true);
  var monto = Number($("#pMonto").value || 0);
  if(!(monto > 0)) return msg("pMsg", "Escribe el monto.", true);
  if(!$("#pVence").value) return msg("pMsg", "Pon la fecha de vencimiento.", true);
  var fila = {
    titulo: titulo,
    proveedor: $("#pProv").value.trim() || null,
    monto: monto,
    moeda: $("#pMoeda").value,
    vence: $("#pVence").value,
    recurrencia: $("#pRec").value,
    nota: $("#pNota").value.trim() || null,
  };
  var r = await rpcP("pagos_factura_guardar", { p_id: EDIT_ID, p_fila: fila });
  if(r.error) return msg("pMsg", errRed(r.error), true);
  msg("pMsg", EDIT_ID ? "✅ Actualizado." : "✅ Guardado.");
  limpiarFormPago();
  cargarPagos();
};
$("#pCancelar").onclick = function(){ limpiarFormPago(); };
function limpiarFormPago(){
  EDIT_ID = null;
  $("#pgFormTitulo").textContent = "➕ Nuevo pago / factura";
  $("#pCancelar").classList.add("hidden");
  ["pTitulo","pProv","pMonto","pNota"].forEach(function(i){ $("#" + i).value = ""; });
  $("#pMoeda").value = "R$"; $("#pRec").value = "nunca"; $("#pVence").value = hoyVE();
}

var PAGOS = [];
async function cargarPagos(){
  if(!tok()) return;
  var err = await cargarDatos();
  if(err){ $("#pLista").innerHTML = '<p class="msg err">' + esc(errRed(err)) + '</p>'; return; }
  PAGOS = DATOS.facturas || [];
  var hoy = hoyVE(), man = addDias(hoy, 1);
  var pend = PAGOS.filter(function(p){ return p.estado === "pendiente"; });
  var grupos = { venc: [], hoy: [], man: [], prox: [] };
  pend.forEach(function(p){
    if(p.vence < hoy) grupos.venc.push(p);
    else if(p.vence === hoy) grupos.hoy.push(p);
    else if(p.vence === man) grupos.man.push(p);
    else grupos.prox.push(p);
  });
  // totales pendientes por moneda
  var tot = {};
  pend.forEach(function(p){ tot[p.moeda] = (tot[p.moeda] || 0) + Number(p.saldo); });
  $("#pTotales").innerHTML = Object.keys(tot).map(function(m){
    return '<span class="tot">Pendiente: <b>' + fmtM(tot[m], m) + '</b></span>';
  }).join("") || "";

  function itemHTML(p, cls, tag){
    var recTxt = { semanal:"🔁 semanal", quincenal:"🔁 quincenal", mensual:"🔁 mensual" }[p.recurrencia] || "";
    return '<div class="item ' + (cls || "") + '">' +
      '<div class="row" style="justify-content:space-between">' +
        '<div style="min-width:0"><b>' + esc(p.titulo) + '</b>' + (p.proveedor ? ' <span class="meta">· ' + esc(p.proveedor) + '</span>' : '') +
        '<div class="meta">' + fmtM(p.monto, p.moeda) + (Number(p.abonado) > 0 ? ' · abonado ' + fmtM(p.abonado, p.moeda) + ' · <b>saldo ' + fmtM(p.saldo, p.moeda) + '</b>' : '') + ' · vence ' + fmtD(p.vence) + (recTxt ? ' · ' + recTxt : '') + (p.nota ? ' · ' + esc(p.nota) : '') + '</div></div>' +
        '<div class="row" style="gap:6px;flex-wrap:nowrap">' + tag +
          '<button class="btn mini" onclick="pagar(\'' + p.id + '\')">💵 Pagar / Abonar</button>' +
          '<button class="btn mini sec" onclick="editarPago(\'' + p.id + '\')">✏️</button>' +
          '<button class="btn mini sec" style="color:var(--bad);border-color:var(--bad)" onclick="borrarPago(\'' + p.id + '\')">🗑</button>' +
        '</div></div></div>';
  }
  var html = "";
  if(grupos.venc.length) html += '<div class="sec-t">⛔ Vencidos</div>' + grupos.venc.map(function(p){ return itemHTML(p, "venc", '<span class="tag venc">vencido</span>'); }).join("");
  if(grupos.hoy.length) html += '<div class="sec-t">📌 Vencen hoy</div>' + grupos.hoy.map(function(p){ return itemHTML(p, "hoy", '<span class="tag hoy">hoy</span>'); }).join("");
  if(grupos.man.length) html += '<div class="sec-t">⏰ Vencen mañana</div>' + grupos.man.map(function(p){ return itemHTML(p, "", '<span class="tag man">mañana</span>'); }).join("");
  if(grupos.prox.length) html += '<div class="sec-t">📅 Próximos</div>' + grupos.prox.map(function(p){ return itemHTML(p, "", '<span class="tag prox">' + fmtD(p.vence) + '</span>'); }).join("");
  $("#pLista").innerHTML = html || '<p style="color:var(--muted);font-size:13.5px;text-align:center;padding:20px">No hay pagos pendientes. 🎉</p>';

  var pagados = PAGOS.filter(function(p){ return p.estado === "pagado"; })
    .sort(function(a,b){ return (b.pagado_at || "").localeCompare(a.pagado_at || ""); }).slice(0, 15);
  $("#pPagados").innerHTML = pagados.map(function(p){
    return '<div class="item"><div class="row" style="justify-content:space-between">' +
      '<div><b>' + esc(p.titulo) + '</b><div class="meta">' + fmtM(p.monto, p.moeda) + ' · pagado ' + (p.pagado_at ? fmtD(p.pagado_at.slice(0,10)) : '') + '</div></div>' +
      '<span class="tag ok">pagado</span></div></div>';
  }).join("") || '<p class="meta" style="padding:8px">Todavía no hay pagos registrados como pagados.</p>';
}

window.pagar = async function(id){
  var p = PAGOS.find(function(x){ return x.id === id; }); if(!p) return;
  var saldo = Number(p.saldo);
  var val = prompt("¿Cuánto pagas de \"" + p.titulo + "\"?\n(Saldo pendiente: " + fmtM(saldo, p.moeda) + " — puedes abonar una parte)", String(saldo));
  if(val === null) return;
  var monto = Number(val);
  if(!(monto > 0)) return msg("pMsg", "Monto inválido.", true);
  if(monto > saldo) return msg("pMsg", "⛔ El pago (" + fmtM(monto, p.moeda) + ") es mayor que el saldo (" + fmtM(saldo, p.moeda) + ").", true);
  var canal = elegirCanalCaja(p.moeda, "pMsg"); if(canal === undefined) return;
  var r = await rpcP("pagos_pagar_factura", { p_factura: id, p_monto: monto, p_canal: canal, p_nota: null });
  if(r.error) return msg("pMsg", errRed(r.error), true);
  var d = r.data || {}; var retiroId = d.retiro;
  if(d.pagada) msg("pMsg", "✅ Factura pagada por completo." + (d.proxima ? " Se creó la próxima (" + fmtD(d.proxima) + ")." : "") + (retiroId ? " Descontado de la caja." : ""));
  else msg("pMsg", "✅ Abono registrado. Saldo restante: " + fmtM(d.saldo, p.moeda) + "." + (retiroId ? " Descontado de la caja." : ""));
  cargarPagos();
};

window.editarPago = function(id){
  var p = PAGOS.find(function(x){ return x.id === id; }); if(!p) return;
  EDIT_ID = id;
  $("#pgFormTitulo").textContent = "✏️ Editando: " + p.titulo;
  $("#pCancelar").classList.remove("hidden");
  $("#pTitulo").value = p.titulo; $("#pProv").value = p.proveedor || "";
  $("#pMonto").value = p.monto; $("#pMoeda").value = p.moeda;
  $("#pVence").value = p.vence; $("#pRec").value = p.recurrencia; $("#pNota").value = p.nota || "";
  scrollTo({ top: 0, behavior: "smooth" });
};
window.borrarPago = async function(id){
  if(!confirm("¿Eliminar este pago?")) return;
  var r = await rpcP("pagos_factura_borrar", { p_id: id });
  if(r.error) return msg("pMsg", "No se eliminó: " + errRed(r.error), true);
  cargarPagos();
};

/* ===== CREDITOS ===== */
var CREDITOS = [], ABONOS = [];
$("#cGuardar").onclick = async function(){
  var prov = $("#cProv").value.trim();
  if(!prov) return msg("cMsg", "Escribe el proveedor.", true);
  var monto = Number($("#cMonto").value || 0);
  if(!(monto > 0)) return msg("cMsg", "Escribe el monto total del crédito.", true);
  var r = await rpcP("pagos_credito_crear", { p_proveedor: prov, p_descripcion: $("#cDesc").value.trim() || null, p_monto: monto, p_moeda: $("#cMoeda").value });
  if(r.error) return msg("cMsg", errRed(r.error), true);
  ["cProv","cDesc","cMonto"].forEach(function(i){ $("#" + i).value = ""; });
  msg("cMsg", "✅ Crédito guardado.");
  cargarCreditos();
};

async function cargarCreditos(){
  if(!tok()) return;
  var err = await cargarDatos();
  if(err){ $("#cLista").innerHTML = '<p class="msg err">' + esc(errRed(err)) + '</p>'; return; }
  CREDITOS = DATOS.creditos || []; ABONOS = DATOS.abonos || [];
  function saldoDe(c){
    var ab = ABONOS.filter(function(a){ return a.credito_id === c.id; }).reduce(function(s,a){ return s + Number(a.monto); }, 0);
    return { abonado: ab, saldo: Number(c.monto_total) - ab };
  }
  function credHTML(c){
    var s = saldoDe(c);
    var abonos = ABONOS.filter(function(a){ return a.credito_id === c.id; });
    return '<div class="card">' +
      '<div class="row" style="justify-content:space-between">' +
        '<div><b>' + esc(c.proveedor) + '</b>' + (c.descripcion ? ' <span class="meta">· ' + esc(c.descripcion) + '</span>' : '') +
        '<div class="meta">Crédito: ' + fmtM(c.monto_total, c.moeda) + ' · Abonado: ' + fmtM(s.abonado, c.moeda) + '</div></div>' +
        '<div style="text-align:right"><div class="saldo" style="color:' + (s.saldo > 0 ? "var(--bad)" : "var(--ok)") + '">' + fmtM(s.saldo, c.moeda) + '</div><div class="meta">saldo</div></div>' +
      '</div>' +
      (abonos.length ? '<div class="meta" style="margin-top:6px">' + abonos.map(function(a){ return '💵 ' + fmtD(a.fecha) + ': ' + fmtM(a.monto, c.moeda) + (a.nota ? ' (' + esc(a.nota) + ')' : ''); }).join('<br>') + '</div>' : '') +
      (!c.cerrado ?
      '<div class="row" style="margin-top:8px">' +
        '<input id="ab-' + c.id + '" type="number" step="0.01" placeholder="Monto del abono" style="width:140px" />' +
        '<input id="abn-' + c.id + '" placeholder="Nota (opcional)" style="flex:1;min-width:90px" />' +
        '<button class="btn mini" onclick="abonar(\'' + c.id + '\')">💵 Abonar</button>' +
        (s.saldo <= 0 ? '<button class="btn mini sec" onclick="cerrarCredito(\'' + c.id + '\')">✔ Cerrar</button>' : '') +
        '<button class="btn mini sec" style="color:var(--bad);border-color:var(--bad)" onclick="borrarCredito(\'' + c.id + '\')">🗑</button>' +
      '</div>' : '<div class="tag ok" style="margin-top:8px">cerrado</div>') +
    '</div>';
  }
  var abiertos = CREDITOS.filter(function(c){ return !c.cerrado; });
  var cerrados = CREDITOS.filter(function(c){ return c.cerrado; });
  $("#cLista").innerHTML = abiertos.map(credHTML).join("") || '<p style="color:var(--muted);font-size:13.5px;text-align:center;padding:20px">No hay créditos abiertos.</p>';
  $("#cCerrados").innerHTML = cerrados.map(credHTML).join("") || '<p class="meta" style="padding:8px">Ninguno todavía.</p>';
}
window.abonar = async function(id){
  var monto = Number(document.getElementById("ab-" + id).value || 0);
  if(!(monto > 0)) return msg("cMsg", "Escribe el monto del abono.", true);
  var cred = CREDITOS.find(function(x){ return x.id === id; });
  if(cred){
    var abonado = ABONOS.filter(function(a){ return a.credito_id === id; }).reduce(function(s,a){ return s + Number(a.monto); }, 0);
    var saldo = Number(cred.monto_total) - abonado;
    if(monto > saldo) return msg("cMsg", "⛔ El abono (" + fmtM(monto, cred.moeda) + ") es mayor que el saldo (" + fmtM(saldo, cred.moeda) + "). Máximo: " + fmtM(saldo, cred.moeda) + ".", true);
  }
  var nota = document.getElementById("abn-" + id).value.trim() || null;
  var canal = cred ? elegirCanalCaja(cred.moeda, "cMsg") : null; if(canal === undefined) return;
  var r = await rpcP("pagos_pagar_credito", { p_credito: id, p_monto: monto, p_canal: canal, p_nota: nota });
  if(r.error) return msg("cMsg", errRed(r.error), true);
  var retiroId = (r.data || {}).retiro;
  msg("cMsg", "✅ Abono registrado." + (retiroId ? " Descontado de la caja." : ""));
  cargarCreditos();
};

window.cerrarCredito = async function(id){
  if(!confirm("¿Cerrar este crédito? (saldo en cero)")) return;
  var r = await rpcP("pagos_credito_cerrar", { p_id: id });
  if(r.error) return msg("cMsg", "No se cerró: " + errRed(r.error), true);
  cargarCreditos();
};
window.borrarCredito = async function(id){
  if(!confirm("¿Eliminar este crédito con sus abonos?")) return;
  var r = await rpcP("pagos_credito_borrar", { p_id: id });
  if(r.error) return msg("cMsg", "No se eliminó: " + errRed(r.error), true);
  cargarCreditos();
};

if(SES) entrar(); else mostrarGate("");
