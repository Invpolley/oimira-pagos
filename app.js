// OiMira Pagos — facturas con vencimiento/recurrencia + creditos con abonos.
var C = window.PG_CONFIG;
var sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
var $ = function(s){ return document.querySelector(s); };
document.getElementById("ver").textContent = C.APP_VERSION;

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
// Pregunta si el pago salio de la caja; si si, crea el retiro y devuelve su id (o null).
async function retiroDesdeCaja(moeda, monto, motivo, destino, nota){
  if(!confirm("¿Este pago salió de la CAJA OiMira?\n\nAceptar = SÍ (se descuenta de la caja)\nCancelar = No (se pagó con otro dinero)")) return null;
  var ops = CANALES_CAJA[moeda] || [];
  var menu = ops.map(function(o,i){ return (i+1) + ". " + o[1]; }).join("\n");
  var sel = prompt("¿De qué caja salió?\n\n" + menu + "\n\nEscribe el número:", "1");
  if(sel === null) return null;
  var idx = parseInt(sel, 10) - 1;
  if(!(idx >= 0 && idx < ops.length)){ msg("pMsg", "Canal inválido — el pago se registró SIN descontar de la caja.", true); return null; }
  var r = await sb.rpc("pagos_registrar_retiro", { p_fecha: hoyVE(), p_canal: ops[idx][0], p_moeda: moeda,
    p_monto: monto, p_motivo: motivo, p_destino: destino || null, p_nota: nota || null });
  if(r.error){ msg("pMsg", "No se pudo crear el retiro en caja: " + r.error.message, true); return null; }
  return r.data;
}
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
  var r;
  if(EDIT_ID) r = await sb.from("pago_factura").update(fila).eq("id", EDIT_ID);
  else r = await sb.from("pago_factura").insert(fila);
  if(r.error) return msg("pMsg", r.error.message, true);
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
  var r = await sb.from("pago_factura_saldo").select("*").order("vence");
  if(r.error){ $("#pLista").innerHTML = '<p class="msg err">' + esc(r.error.message) + '</p>'; return; }
  PAGOS = r.data || [];
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
  var retiroId = await retiroDesdeCaja(p.moeda, monto, "Pago proveedor", p.proveedor || p.titulo, "OiMira Pagos: " + p.titulo);
  var r = await sb.rpc("pago_abonar_factura", { p_factura: id, p_monto: monto, p_nota: null, p_retiro: retiroId });
  if(r.error) return msg("pMsg", r.error.message, true);
  var d = r.data || {};
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
  await sb.from("pago_factura").delete().eq("id", id);
  cargarPagos();
};

/* ===== CREDITOS ===== */
var CREDITOS = [], ABONOS = [];
$("#cGuardar").onclick = async function(){
  var prov = $("#cProv").value.trim();
  if(!prov) return msg("cMsg", "Escribe el proveedor.", true);
  var monto = Number($("#cMonto").value || 0);
  if(!(monto > 0)) return msg("cMsg", "Escribe el monto total del crédito.", true);
  var r = await sb.from("pago_credito").insert({ proveedor: prov, descripcion: $("#cDesc").value.trim() || null, monto_total: monto, moeda: $("#cMoeda").value });
  if(r.error) return msg("cMsg", r.error.message, true);
  ["cProv","cDesc","cMonto"].forEach(function(i){ $("#" + i).value = ""; });
  msg("cMsg", "✅ Crédito guardado.");
  cargarCreditos();
};

async function cargarCreditos(){
  var rc = await sb.from("pago_credito").select("*").order("created_at", { ascending: false });
  var ra = await sb.from("pago_credito_abono").select("*").order("fecha");
  if(rc.error){ $("#cLista").innerHTML = '<p class="msg err">' + esc(rc.error.message) + '</p>'; return; }
  CREDITOS = rc.data || []; ABONOS = ra.data || [];
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
  var retiroId = cred ? await retiroDesdeCaja(cred.moeda, monto, "Abono a crédito", cred.proveedor, "OiMira Pagos: abono crédito " + cred.proveedor) : null;
  var r = await sb.rpc("pago_abonar_credito", { p_credito: id, p_monto: monto, p_nota: nota, p_retiro: retiroId });
  if(r.error) return msg("cMsg", r.error.message, true);
  msg("cMsg", "✅ Abono registrado." + (retiroId ? " Descontado de la caja." : ""));
  cargarCreditos();
};

window.cerrarCredito = async function(id){
  if(!confirm("¿Cerrar este crédito? (saldo en cero)")) return;
  await sb.from("pago_credito").update({ cerrado: true }).eq("id", id);
  cargarCreditos();
};
window.borrarCredito = async function(id){
  if(!confirm("¿Eliminar este crédito con sus abonos?")) return;
  await sb.from("pago_credito").delete().eq("id", id);
  cargarCreditos();
};

cargarPagos();
