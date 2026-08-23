
const API_URL = "https://script.google.com/macros/s/AKfycbz_bfOC-pXiDFrjFw3sr9bH1Ly5VPsXoARwTVihY4Mw5c3UNB58BbmFvoOJy5-sjjKW/exec";

let bridgeReady = false;
let bridgeQueue = [];

let token = "";
let user = null;
let kelas = null;
let jurnal = null;
let piketJurnal = null;
let lastStudent = null;

let scannerClass = null;
let scannerStudent = null;
let scannerAttendance = null;
let scannerPiket = null;

let pendingCameraStart = null;
let currentPage = "dashboardPage";
let historyStack = [];

const $ = id => document.getElementById(id);

function bridgeReady(){
  return $("apiBridge").contentWindow !== null;
}

function callApi(action, payload = {}) {

  return new Promise((resolve, reject) => {

    const request = {
      action,
      payload,
      resolve,
      reject
    };

    if (!bridgeReady) {

      bridgeQueue.push(request);

      setTimeout(() => {

        const index =
          bridgeQueue.indexOf(request);

        if (index !== -1) {

          bridgeQueue.splice(index, 1);

          reject(
            new Error(
              "Bridge belum siap. Silakan tunggu beberapa detik lalu coba lagi."
            )
          );
        }

      }, 15000);

      return;
    }

    sendApiRequest(request);
  });
}


function sendApiRequest(request) {

  const requestId =
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now() + "-" + Math.random();

  const timer =
    setTimeout(() => {

      window.removeEventListener(
        "message",
        handler
      );

      request.reject(
        new Error(
          "Server tidak merespons. Periksa koneksi internet."
        )
      );

    }, 30000);


  function handler(event) {

    const bridge =
      $("apiBridge");

    if (
      !bridge ||
      event.source !== bridge.contentWindow
    ) {
      return;
    }

    const msg =
      event.data || {};

    if (
      msg.type !== "MTC_RESPONSE" ||
      msg.requestId !== requestId
    ) {
      return;
    }

    clearTimeout(timer);

    window.removeEventListener(
      "message",
      handler
    );

    if (msg.success) {

      request.resolve(
        msg.data
      );

    } else {

      request.reject(
        new Error(
          msg.error ||
          "Terjadi kesalahan pada server."
        )
      );

    }
  }


  window.addEventListener(
    "message",
    handler
  );


  $("apiBridge")
    .contentWindow
    .postMessage(
      {
        type: "MTC_REQUEST",
        requestId,
        action: request.action,
        payload: request.payload
      },
      "*"
    );
}


function showPage(id, push = true){
  const pages = ["dashboardPage","attendancePage","classScanPage","journalPage","studentScanPage","piketPage"];
  pages.forEach(p => $(p).classList.add("hidden"));
  $(id).classList.remove("hidden");
  currentPage = id;

  if(push){
    historyStack.push(id);
    history.pushState({page:id}, "", "#" + id);
  }

  stopScannersExcept(id);
  $("sidebar").classList.remove("open");
}

function goBack(){
  if(historyStack.length > 1){
    historyStack.pop();
    const previous = historyStack[historyStack.length - 1];
    showPage(previous, false);
    history.replaceState({page:previous}, "", "#" + previous);
  }else{
    showPage("dashboardPage", false);
  }
}

window.addEventListener("popstate", () => {
  goBack();
});

function toggleSidebar(){
  $("sidebar").classList.toggle("open");
}

function stopScanner(scanner){
  if(!scanner) return;
  scanner.stop().catch(()=>{});
}

function stopScannersExcept(page){
  if(page !== "classScanPage") { stopScanner(scannerClass); scannerClass=null; }
  if(page !== "studentScanPage") { stopScanner(scannerStudent); scannerStudent=null; }
  if(page !== "attendancePage") { stopScanner(scannerAttendance); scannerAttendance=null; }
  if(page !== "piketPage") { stopScanner(scannerPiket); scannerPiket=null; }
}

function askCamera(startFunction){
  pendingCameraStart = startFunction;
  $("cameraMessage").innerHTML = "";
  $("cameraModal").classList.remove("hidden");
}

async function confirmCamera(){
  try{
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      throw new Error("Browser ini tidak mendukung akses kamera. Gunakan Chrome versi terbaru.");
    }

    $("cameraMessage").innerHTML = '<div class="status">Meminta izin kamera...</div>';

    const stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:"environment"}
    });

    stream.getTracks().forEach(t => t.stop());

    $("cameraModal").classList.add("hidden");

    const action = pendingCameraStart;
    pendingCameraStart = null;

    if(action) action();
  }catch(err){
    $("cameraMessage").innerHTML =
      '<div class="status result-error">' +
      'Kamera belum diizinkan. Buka ikon 🔒/izin di address bar Chrome, pilih Kamera → Izinkan, lalu kembali ke aplikasi.' +
      '</div>';
  }
}

function cancelCamera(){
  pendingCameraStart = null;
  $("cameraModal").classList.add("hidden");
}

async function login(){
  const username = $("username").value.trim();
  const password = $("password").value.trim();

  if(!username || !password){
    $("loginMessage").innerHTML = '<div class="status result-error">Username dan password wajib diisi.</div>';
    return;
  }

  $("loginMessage").innerHTML = '<div class="status">Memeriksa akun...</div>';

  try{
    const res = await callApi("login", {username, password});
    token = res.token;
    user = res.user;

    $("welcomeName").textContent = user.nama;
    $("userPill").textContent = user.nama;
    $("loginPage").classList.add("hidden");
    $("appPage").classList.remove("hidden");

    historyStack = ["dashboardPage"];
    history.replaceState({page:"dashboardPage"}, "", "#dashboardPage");
    showPage("dashboardPage", false);
  }catch(err){
    $("loginMessage").innerHTML = '<div class="status result-error">' + escapeHtml(err.message) + '</div>';
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* PRESENSI SISWA */
function openAttendance(){
  showPage("attendancePage");
  $("waBox").classList.add("hidden");
  askCamera(startAttendanceScanner);
}

function startAttendanceScanner(){
  scannerAttendance = new Html5Qrcode("readerAttendance");
  scannerAttendance.start(
    {facingMode:"environment"},
    {fps:10, qrbox:250},
    text => processAttendance(text)
  ).catch(err => {
    $("attendanceResult").innerHTML = '<div class="result result-error">Scanner gagal dibuka: ' + escapeHtml(err.message) + '</div>';
  });
}

async function processAttendance(code){
  const jenis = $("attendanceType").value;
  try{
    const res = await callApi("scanSiswa", {
      kodeSiswa: code.trim(),
      jenisPresensi: jenis
    });

    if(res.duplicate){
      $("attendanceResult").innerHTML = '<div class="result result-error">⚠ ' + escapeHtml(res.message) + '</div>';
      return;
    }

    lastStudent = res;
    $("attendanceResult").innerHTML =
      '<div class="result result-success">✓ SUKSES<br><b>' +
      escapeHtml(res.nama) +
      '</b><br>' +
      escapeHtml(res.jenis) +
      '<br>' +
      escapeHtml(res.jam) +
      '</div>';

    buildWaMessage(res);
  }catch(err){
    $("attendanceResult").innerHTML = '<div class="result result-error">✕ ' + escapeHtml(err.message) + '</div>';
  }
}

function submitManualAttendance(){
  const nisn = $("manualAttendanceNISN").value.trim();
  if(nisn) processAttendance(nisn);
  $("manualAttendanceNISN").value = "";
}

function buildWaMessage(data){
  if(!data.wa){
    $("waBox").classList.add("hidden");
    return;
  }

  const text = data.jenis === "MASUK"
    ? `Yth. Bapak/Ibu Orang Tua/Wali Siswa.\n\nKami menginformasikan bahwa putra/putri Bapak/Ibu, ${data.nama}, telah tiba di sekolah pada ${data.jam}.\n\nTerima kasih atas perhatian dan dukungan Bapak/Ibu.\n\nHormat kami,\nSMAN 1 JETIS PONOROGO`
    : `Yth. Bapak/Ibu Orang Tua/Wali Siswa.\n\nKami menginformasikan bahwa putra/putri Bapak/Ibu, ${data.nama}, telah melakukan presensi pulang pada ${data.jam}.\n\nTerima kasih.\n\nHormat kami,\nSMAN 1 JETIS PONOROGO`;

  $("waMessage").value = text;
  $("waBox").classList.remove("hidden");
}

function waNumber(value){
  let n = String(value || "").replace(/\D/g,"");
  if(n.startsWith("0")) n = "62" + n.slice(1);
  return n;
}

function sendWa(){
  if(!lastStudent) return;
  const n = waNumber(lastStudent.wa);
  if(!n){ alert("Nomor WhatsApp tidak tersedia."); return; }
  const url = "https://wa.me/" + n + "?text=" + encodeURIComponent($("waMessage").value);
  window.open(url, "_blank");
}

/* SCAN KELAS */
function openJournal(){
  showPage("classScanPage");
  askCamera(startClassScanner);
}

function startClassScanner(){
  scannerClass = new Html5Qrcode("readerClass");
  scannerClass.start(
    {facingMode:"environment"},
    {fps:10, qrbox:250},
    text => onClassScan(text)
  ).catch(err => {
    $("classMessage").innerHTML = '<div class="status result-error">Scanner gagal dibuka.</div>';
  });
}

async function onClassScan(code){
  stopScanner(scannerClass); scannerClass=null;
  try{
    const res = await callApi("cariKelasPublic", {kode:code.trim()});
    if(!res) throw new Error("QR kelas tidak ditemukan.");
    kelas = res;
    $("journalGuru").textContent = user.nama;
    $("journalClass").textContent = kelas.nama;
    showPage("journalPage");
  }catch(err){
    $("classMessage").innerHTML = '<div class="status result-error">' + escapeHtml(err.message) + '</div>';
  }
}

async function getLocation(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation) return reject(new Error("Perangkat tidak mendukung GPS."));
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        latitude:p.coords.latitude,
        longitude:p.coords.longitude,
        accuracy:p.coords.accuracy
      }),
      () => reject(new Error("Lokasi belum diizinkan. Aktifkan GPS dan izinkan Lokasi untuk browser.")),
      {enableHighAccuracy:true, timeout:15000, maximumAge:0}
    );
  });
}

async function startJournal(){
  const mapel = $("journalMapel").value.trim();
  const jamKe = $("journalJam").value.trim();
  const materi = $("journalMateri").value.trim();

  if(!mapel || !jamKe || !materi){
    $("journalMessage").innerHTML = '<div class="status result-error">Mapel, jam ke, dan materi wajib diisi.</div>';
    return;
  }

  try{
    $("journalMessage").innerHTML = '<div class="status">Memeriksa lokasi...</div>';
    const loc = await getLocation();

    const res = await callApi("buatJurnal", {
      kodeKelas:kelas.kode,
      mapel,
      jamKe,
      materi,
      latitude:loc.latitude,
      longitude:loc.longitude,
      accuracy:loc.accuracy
    });

    jurnal = res;
    $("classTeacher").textContent = res.guru;
    $("className").textContent = res.kelas;
    showPage("studentScanPage");
    askCamera(startStudentScanner);
  }catch(err){
    $("journalMessage").innerHTML = '<div class="status result-error">' + escapeHtml(err.message) + '</div>';
  }
}

function startStudentScanner(){
  scannerStudent = new Html5Qrcode("readerStudent");
  scannerStudent.start(
    {facingMode:"environment"},
    {fps:10, qrbox:250},
    text => scanStudent(text)
  ).catch(err => {
    $("scanResult").innerHTML = '<div class="result result-error">Scanner gagal dibuka.</div>';
  });
}

async function scanStudent(code){
  try{
    const res = await callApi("scanSiswa", {
      mode:"JURNAL",
      kodeSiswa:code.trim(),
      idJurnal:jurnal.idJurnal,
      kelas:jurnal.kelas,
      mapel:jurnal.mapel,
      jamKe:jurnal.jamKe,
      latitude:jurnal.lokasi.latitude,
      longitude:jurnal.lokasi.longitude,
      accuracy:jurnal.lokasi.accuracy
    });

    $("scanResult").innerHTML = res.duplicate
      ? '<div class="result result-error">⚠ ' + escapeHtml(res.message) + '</div>'
      : '<div class="result result-success">✓ SUKSES<br>' + escapeHtml(res.nama) + '<br>' + escapeHtml(res.jam) + '</div>';
  }catch(err){
    $("scanResult").innerHTML = '<div class="result result-error">✕ ' + escapeHtml(err.message) + '</div>';
  }
}

/* PIKET */
async function openPiket(){
  showPage("piketPage");
  $("piketForm").classList.add("hidden");
  try{
    const list = await callApi("getJurnalAktif", {token});
    const sel = $("piketJurnal");
    sel.innerHTML = '<option value="">Pilih jurnal aktif</option>';
    list.forEach(item=>{
      const o = document.createElement("option");
      o.value = JSON.stringify(item);
      o.textContent = `${item.kelas} | ${item.mapel} | Jam ${item.jamKe} | ${item.guru}`;
      sel.appendChild(o);
    });
  }catch(err){
    $("piketInfo").innerHTML = '<div class="status result-error">' + escapeHtml(err.message) + '</div>';
  }
}

function selectPiketJournal(){
  const val = $("piketJurnal").value;
  if(!val) return;
  piketJurnal = JSON.parse(val);
  $("piketInfo").innerHTML =
    '<div class="info-box">Kelas: <b>' + escapeHtml(piketJurnal.kelas) +
    '</b><br>Mapel: <b>' + escapeHtml(piketJurnal.mapel) +
    '</b><br>Jam: <b>' + escapeHtml(piketJurnal.jamKe) +
    '</b><br>Guru: <b>' + escapeHtml(piketJurnal.guru) + '</b></div>';
  $("piketForm").classList.remove("hidden");
  askCamera(startPiketScanner);
}

function startPiketScanner(){
  scannerPiket = new Html5Qrcode("readerPiket");
  scannerPiket.start(
    {facingMode:"environment"},
    {fps:10, qrbox:250},
    text => scanPiket(text)
  ).catch(()=> {
    $("piketResult").innerHTML = '<div class="result result-error">Scanner gagal dibuka.</div>';
  });
}

async function scanPiket(code){
  try{
    const res = await callApi("simpanDispensasi", {
      token,
      nisn:code.trim(),
      idJurnal:piketJurnal.idJurnal,
      kelas:piketJurnal.kelas,
      jenis:$("piketJenis").value,
      alasan:$("piketAlasan").value,
      keterangan:$("piketKeterangan").value
    });
    $("piketResult").innerHTML = '<div class="result result-success">✓ SUKSES<br>' + escapeHtml(res.nama) + '<br>' + escapeHtml(res.jam) + '</div>';
  }catch(err){
    $("piketResult").innerHTML = '<div class="result result-error">✕ ' + escapeHtml(err.message) + '</div>';
  }
}

function submitManualPiket(){
  const n = $("manualPiketNISN").value.trim();
  if(n) scanPiket(n);
  $("manualPiketNISN").value = "";
}

/* WIRING */
$("loginBtn").onclick = login;
$("menuToggle").onclick = toggleSidebar;
$("menuAttendance").onclick = openAttendance;
$("menuJournal").onclick = openJournal;
$("menuPiket").onclick = openPiket;
$("navAttendance").onclick = openAttendance;
$("navJournal").onclick = openJournal;
$("navPiket").onclick = openPiket;
$("logoutBtn").onclick = async () => {
  try{ await callApi("logout", {token}); }catch(e){}
  location.reload();
};
$("waBtn").onclick = sendWa;
$("manualAttendanceBtn").onclick = submitManualAttendance;
$("startJournalBtn").onclick = startJournal;
$("selectPiketJournalBtn").onclick = selectPiketJournal;
$("manualPiketBtn").onclick = submitManualPiket;
$("cameraStartBtn").onclick = confirmCamera;
$("cameraCancelBtn").onclick = cancelCamera;
document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", goBack));

$("apiBridge").src = API_URL + "?bridge=1";

window.addEventListener("load", () => {
  history.replaceState({page:"dashboardPage"}, "", "#dashboardPage");
  historyStack = ["dashboardPage"];
});


window.addEventListener(
  "message",
  function(event) {

    const bridge =
      $("apiBridge");

    if (
      !bridge ||
      event.source !== bridge.contentWindow
    ) {
      return;
    }

    if (
      event.data &&
      event.data.type ===
      "MTC_BRIDGE_READY"
    ) {

      bridgeReady = true;

      console.log(
        "Multi Tap Connect: Bridge siap."
      );

      const queue =
        [...bridgeQueue];

      bridgeQueue = [];

      queue.forEach(
        function(request) {
          sendApiRequest(request);
        }
      );
    }
  }
);

$("apiBridge").src =
  API_URL + "?bridge=1";

