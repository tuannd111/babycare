/* Đăng nhập và ghi chung theo gia đình qua Firebase (Auth + Firestore).
   Chỉ bật khi firebase-config.js có cấu hình; nếu không, trang chạy như cũ với dữ liệu trên máy.

   Dữ liệu trên Firestore (luật bảo mật: firestore.rules):
     users/{uid}                      { name, familyId }
     invites/{mã}                     { familyId }                 — mã mời 8 ký tự
     families/{fid}                   { name, members: [uid], memberNames: {uid: tên}, inviteCode, createdBy, createdAt }
     families/{fid}/state/main        { dob, checks, customChecks, dayTasksCustom, mine }   — các khóa trong SYNC_KEYS
     families/{fid}/days/{YYYY-MM-DD} { date, done: {khóa: true}, feeds: [{ t, by }], wet, dirty }

   Dùng các biến chung của script chính: $, esc, store, cloud, SYNC_KEYS, today, dayKey, refreshAll, renderDay. */
(function () {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) return;

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const load = src => new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s);
  });
  load(SDK + 'firebase-app-compat.js')
    .then(() => Promise.all([load(SDK + 'firebase-auth-compat.js'), load(SDK + 'firebase-firestore-compat.js')]))
    .then(init)
    .catch(() => console.warn('Không tải được Firebase; trang chạy với dữ liệu trên máy.'));

  function init() {
    firebase.initializeApp(cfg);
    const auth = firebase.auth(), db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); // ghi được cả khi mất mạng, gửi lại khi có mạng
    const FV = firebase.firestore.FieldValue;
    const DEFAULTS = { dob: '', checks: {}, customChecks: {}, dayTasksCustom: [], mine: [] };
    const clone = v => JSON.parse(JSON.stringify(v));

    let user = null, profile = null, family = null, unsubs = [], cache = {};
    let view = { mode: 'in', msg: '', ok: false, busy: false };
    const dlg = $('#acctDlg'), body = $('#acctBody'), btn = $('#acctBtn'), hint = $('#syncHint');
    btn.hidden = false;

    /* ---------- Gửi thay đổi lên ---------- */
    const famRef = () => db.doc('families/' + family.id);
    const report = e => { console.warn(e); };

    cloud.pushState = (k, v) => {
      let data;
      if (k === 'checks' || k === 'customChecks') {
        // Chỉ gửi những mục đổi, để hai người tích hai món khác nhau cùng lúc không đè nhau.
        const prev = cache[k] || {}, patch = {};
        new Set([...Object.keys(prev), ...Object.keys(v)]).forEach(sk => {
          if (!(sk in v)) patch[sk] = FV.delete();
          else if (JSON.stringify(prev[sk]) !== JSON.stringify(v[sk])) patch[sk] = v[sk];
        });
        if (!Object.keys(patch).length) return;
        data = { [k]: patch };
      } else {
        data = { [k]: v };
      }
      cache[k] = clone(v);
      famRef().collection('state').doc('main').set(data, { merge: true }).catch(report);
    };

    cloud.dayOp = (date, op) => {
      const data = { date };
      if (op.type === 'feed+') data.feeds = FV.arrayUnion(op.entry);
      else if (op.type === 'feed-') data.feeds = FV.arrayRemove(op.entry);
      else if (op.type === 'inc') data[op.f] = FV.increment(op.d);
      else if (op.type === 'done') data.done = { [op.k]: op.v ? true : FV.delete() };
      famRef().collection('days').doc(date).set(data, { merge: true }).catch(report);
    };

    /* ---------- Nhận dữ liệu gia đình ---------- */
    function stopListeners() { unsubs.forEach(u => u()); unsubs = []; cloud.active = false; }

    async function attachFamily(fid) {
      stopListeners();
      const ref = db.doc('families/' + fid);
      try {
        const f = await ref.get();
        if (!f.exists) return false;
        family = Object.assign({ id: fid }, f.data());
      } catch (e) { report(e); family = null; return false; }
      cloud.active = true;
      cloud.me = (profile && profile.name) || user.email || 'Không tên';
      unsubs.push(ref.onSnapshot(s => { if (s.exists) { family = Object.assign({ id: fid }, s.data()); render(); } }, report));
      unsubs.push(ref.collection('state').doc('main').onSnapshot(s => {
        const d = s.data() || {};
        SYNC_KEYS.forEach(k => {
          const v = d[k] !== undefined ? d[k] : DEFAULTS[k];
          cache[k] = clone(v); store.set(k, v, true);
        });
        refreshAll();
      }, report));
      const since = new Date(); since.setDate(since.getDate() - 8);
      unsubs.push(ref.collection('days').where('date', '>=', dayKey(since)).onSnapshot(qs => {
        const log = {};
        qs.forEach(doc => {
          const x = doc.data();
          log[doc.id] = { done: x.done || {}, feeds: (x.feeds || []).slice().sort((a, b) => a.t - b.t), wet: x.wet || 0, dirty: x.dirty || 0 };
        });
        store.set('dayLog', log, true); renderDay();
      }, report));
      return true;
    }

    auth.onAuthStateChanged(async u => {
      stopListeners(); user = u; profile = null; family = null;
      if (u) {
        try {
          const snap = await db.doc('users/' + u.uid).get();
          profile = snap.exists ? snap.data() : null;
        } catch (e) { report(e); }
        profile = Object.assign({ name: u.displayName || '', familyId: null }, profile);
        if (profile.familyId) await attachFamily(profile.familyId);
      }
      view = { mode: 'in', msg: '', ok: false, busy: false };
      render();
    });

    /* ---------- Thao tác tài khoản ---------- */
    const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const newCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map(n => ALPHA[n % ALPHA.length]).join('');

    async function createFamily(name, famName) {
      const uid = user.uid, code = newCode();
      const ref = db.collection('families').doc();
      await ref.set({ name: famName, members: [uid], memberNames: { [uid]: name }, inviteCode: code, createdBy: uid, createdAt: FV.serverTimestamp() });
      await db.doc('invites/' + code).set({ familyId: ref.id });
      // Đưa dữ liệu đang có trên máy này vào gia đình mới.
      const batch = db.batch(), state = {};
      SYNC_KEYS.forEach(k => { state[k] = store.get(k, DEFAULTS[k]); });
      batch.set(ref.collection('state').doc('main'), state);
      Object.entries(store.get('dayLog', {})).forEach(([date, d]) => {
        batch.set(ref.collection('days').doc(date), {
          date, done: d.done || {}, wet: d.wet || 0, dirty: d.dirty || 0,
          feeds: (d.feeds || []).map(f => (typeof f === 'number' ? { t: f, by: name } : f))
        });
      });
      await batch.commit();
      await db.doc('users/' + uid).set({ name, familyId: ref.id }, { merge: true });
      profile = Object.assign(profile, { name, familyId: ref.id });
      await attachFamily(ref.id);
    }

    async function joinFamily(name, rawCode) {
      const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 8) throw { code: 'join/not-found' };
      const inv = await db.doc('invites/' + code).get();
      if (!inv.exists) throw { code: 'join/not-found' };
      const fid = inv.data().familyId;
      await db.doc('families/' + fid).update({ members: FV.arrayUnion(user.uid), ['memberNames.' + user.uid]: name, joinCode: code });
      await db.doc('users/' + user.uid).set({ name, familyId: fid }, { merge: true });
      profile = Object.assign(profile, { name, familyId: fid });
      await attachFamily(fid);
    }

    async function rename(name) {
      await db.doc('users/' + user.uid).set({ name }, { merge: true });
      await famRef().update({ ['memberNames.' + user.uid]: name });
      profile.name = name; cloud.me = name;
    }

    function signOut() {
      stopListeners();
      // Xóa dữ liệu gia đình khỏi máy này, để người khác dùng máy không thấy.
      [...SYNC_KEYS, 'dayLog'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      cache = {};
      refreshAll();
      return auth.signOut();
    }

    const ERR = {
      'auth/invalid-email': 'Email không hợp lệ.',
      'auth/missing-password': 'Hãy nhập mật khẩu.',
      'auth/user-not-found': 'Email hoặc mật khẩu không đúng.',
      'auth/wrong-password': 'Email hoặc mật khẩu không đúng.',
      'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
      'auth/invalid-login-credentials': 'Email hoặc mật khẩu không đúng.',
      'auth/email-already-in-use': 'Email này đã có tài khoản. Hãy chọn “Đăng nhập”.',
      'auth/weak-password': 'Mật khẩu cần ít nhất 6 ký tự.',
      'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ đăng nhập Google.',
      'auth/cancelled-popup-request': 'Bạn đã đóng cửa sổ đăng nhập Google.',
      'auth/unauthorized-domain': 'Địa chỉ trang này chưa được thêm vào “Authorized domains” trong Firebase.',
      'auth/operation-not-allowed': 'Cách đăng nhập này chưa được bật trong Firebase Authentication.',
      'auth/network-request-failed': 'Không có mạng. Kiểm tra kết nối rồi thử lại.',
      'auth/too-many-requests': 'Thử quá nhiều lần. Đợi vài phút rồi thử lại.',
      'permission-denied': 'Không có quyền ghi. Kiểm tra lại luật bảo mật Firestore (firestore.rules).',
      'unavailable': 'Không có mạng. Kiểm tra kết nối rồi thử lại.',
      'join/not-found': 'Không tìm thấy mã mời này. Kiểm tra lại 8 ký tự.'
    };
    const errText = e => ERR[e && e.code] || ('Có lỗi xảy ra' + (e && e.code ? ` (${e.code})` : '') + '. Thử lại sau.');

    async function run(fn, okMsg) {
      view.busy = true; view.msg = ''; render();
      try { await fn(); view.msg = okMsg || ''; view.ok = true; }
      catch (e) { report(e); view.msg = errText(e); view.ok = false; }
      view.busy = false; render();
    }

    /* ---------- Giao diện ---------- */
    const initial = s => esc((s || '?').trim().charAt(0).toUpperCase() || '?');
    const memberList = () => family ? Object.entries(family.memberNames || {}).filter(([uid]) => (family.members || []).includes(uid)).map(([, n]) => n) : [];

    function render() {
      // Nút trên thanh menu
      if (!user) { btn.className = 'acct-btn out'; btn.innerHTML = '<span class="nm">Đăng nhập</span>'; }
      else { const n = (profile && profile.name) || user.email; btn.className = 'acct-btn'; btn.innerHTML = `<span class="av">${initial(n)}</span><span class="nm">${esc(n)}</span>`; }
      btn.setAttribute('aria-label', user ? 'Tài khoản và gia đình' : 'Đăng nhập');

      // Dòng nhắc trong mục Mỗi ngày
      hint.hidden = false;
      if (!user) hint.innerHTML = '<span>Đăng nhập để bố mẹ cùng ghi một nhật ký trên nhiều điện thoại.</span><button class="btn lamp" type="button" data-open-acct>Đăng nhập</button>';
      else if (!family) hint.innerHTML = '<span>Tạo gia đình hoặc nhập mã mời để ghi chung với người nhà.</span><button class="btn lamp" type="button" data-open-acct>Thiết lập gia đình</button>';
      else hint.innerHTML = `<span>Đang ghi chung với <strong>${esc(family.name)}</strong>: ${memberList().map(esc).join(', ')}.</span>`;

      if (dlg.open) renderDialog();
    }

    const msgHtml = () => view.msg ? `<p class="msg ${view.ok ? 'ok' : ''}" role="status">${esc(view.msg)}</p>` : '';
    const dis = () => view.busy ? 'disabled' : '';
    const head = title => `<div class="dlg-top"><h3 id="acctTitle">${title}</h3><button class="linkbtn" type="button" data-close>Đóng</button></div>`;

    function renderDialog() {
      if (!user) {
        const up = view.mode === 'up';
        body.innerHTML = `${head('Đăng nhập để cả nhà cùng ghi')}
          <p class="muted small">Nhật ký mỗi ngày, danh sách chuẩn bị, ngày sinh và danh bạ sẽ được lưu theo gia đình. Mở trên máy nào cũng thấy.</p>
          <button class="btn ghost full" type="button" id="gBtn" ${dis()}>Tiếp tục với Google</button>
          <div class="or">hoặc dùng email</div>
          <div class="seg" role="group" aria-label="Chọn">
            <button type="button" data-mode="in" aria-pressed="${!up}">Đăng nhập</button>
            <button type="button" data-mode="up" aria-pressed="${up}">Tạo tài khoản</button>
          </div>
          <form id="emailForm" class="stack" style="gap:10px">
            <label class="field" for="aEmail">Email<input type="email" id="aEmail" required autocomplete="email"></label>
            <label class="field" for="aPass">Mật khẩu<input type="password" id="aPass" required minlength="6" autocomplete="${up ? 'new-password' : 'current-password'}"></label>
            <button class="btn full" type="submit" ${dis()}>${up ? 'Tạo tài khoản' : 'Đăng nhập'}</button>
            ${up ? '' : '<button class="linkbtn" type="button" id="aForgot" style="justify-self:start">Quên mật khẩu?</button>'}
          </form>${msgHtml()}`;
        $('#gBtn').onclick = () => run(async () => {
          const p = new firebase.auth.GoogleAuthProvider();
          try { await auth.signInWithPopup(p); }
          catch (e) { if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await auth.signInWithRedirect(p); else throw e; }
        });
        body.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { view.mode = b.dataset.mode; view.msg = ''; renderDialog(); }; });
        $('#emailForm').onsubmit = e => {
          e.preventDefault();
          const em = $('#aEmail').value.trim(), pw = $('#aPass').value;
          run(() => (up ? auth.createUserWithEmailAndPassword(em, pw) : auth.signInWithEmailAndPassword(em, pw)));
        };
        if (!up) $('#aForgot').onclick = () => {
          const em = $('#aEmail').value.trim();
          if (!em) { view.msg = 'Nhập email trước, rồi bấm “Quên mật khẩu?”.'; view.ok = false; renderDialog(); return; }
          run(() => auth.sendPasswordResetEmail(em), 'Đã gửi email đặt lại mật khẩu. Kiểm tra hộp thư (cả mục Spam).');
        };
        return;
      }

      if (!family) {
        body.innerHTML = `${head('Thiết lập gia đình')}
          <p class="muted small">Đã đăng nhập: ${esc(user.email || '')}</p>
          <label class="field" for="fName">Bạn là ai trong nhà?<input type="text" id="fName" maxlength="30" placeholder="VD: Bố, Mẹ, Bà ngoại" value="${esc(profile.name || '')}"></label>
          <div class="box">
            <h4>Tạo gia đình mới</h4>
            <div class="inline"><input type="text" id="famName" maxlength="40" placeholder="VD: Nhà bé Bông" aria-label="Tên gia đình"><button class="btn" type="button" id="famCreate" ${dis()}>Tạo</button></div>
            <small class="muted">Dữ liệu đang có trên máy này sẽ được đưa vào gia đình.</small>
          </div>
          <div class="box">
            <h4>Đã có người nhà tạo rồi?</h4>
            <div class="inline"><input type="text" id="joinCode" maxlength="12" placeholder="Mã mời 8 ký tự" autocapitalize="characters" aria-label="Mã mời"><button class="btn" type="button" id="famJoin" ${dis()}>Tham gia</button></div>
            <small class="muted">Dữ liệu trên máy này sẽ được thay bằng dữ liệu của gia đình.</small>
          </div>
          ${msgHtml()}
          <button class="linkbtn" type="button" id="signOut" style="justify-self:start">Đăng xuất</button>`;
        const needName = () => { const n = $('#fName').value.trim(); if (!n) { view.msg = 'Hãy nhập tên của bạn trong nhà, ví dụ “Bố” hoặc “Mẹ”.'; view.ok = false; renderDialog(); $('#fName').focus(); } return n; };
        $('#famCreate').onclick = () => {
          const n = needName(); if (!n) return;
          const fam = $('#famName').value.trim() || 'Nhà mình';
          run(() => createFamily(n, fam), 'Đã tạo gia đình. Gửi mã mời cho người nhà để cùng ghi.');
        };
        $('#famJoin').onclick = () => {
          const n = needName(); if (!n) return;
          run(() => joinFamily(n, $('#joinCode').value), 'Đã vào gia đình.');
        };
        $('#signOut').onclick = () => run(signOut);
        return;
      }

      body.innerHTML = `${head(esc(family.name))}
        <div class="members">${memberList().map(n => `<span><i class="av">${initial(n)}</i>${esc(n)}</span>`).join('')}</div>
        <div class="box">
          <h4>Mã mời người nhà</h4>
          <div class="row" style="justify-content:space-between"><span class="code" id="invCode">${esc(family.inviteCode || '')}</span><button class="btn ghost" type="button" id="copyCode">Sao chép</button></div>
          <small class="muted">Người nhà mở trang này, đăng nhập, rồi nhập mã ở mục “Đã có người nhà tạo rồi?”.</small>
        </div>
        <div class="box">
          <h4>Tên của bạn</h4>
          <div class="inline"><input type="text" id="myName" maxlength="30" value="${esc(profile.name || '')}" aria-label="Tên của bạn"><button class="btn ghost" type="button" id="saveName" ${dis()}>Lưu</button></div>
          <small class="muted">Hiện bên cạnh mỗi cữ bú bạn ghi. Đăng nhập bằng ${esc(user.email || '')}.</small>
        </div>
        ${msgHtml()}
        <button class="linkbtn" type="button" id="signOut" style="justify-self:start">Đăng xuất khỏi máy này</button>`;
      $('#copyCode').onclick = e => {
        const b = e.target, done = () => { b.textContent = 'Đã chép'; setTimeout(() => { b.textContent = 'Sao chép'; }, 1500); };
        const fallback = () => { const r = document.createRange(); r.selectNodeContents($('#invCode')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
        try { navigator.clipboard.writeText(family.inviteCode).then(done, fallback); } catch (err) { fallback(); }
      };
      $('#saveName').onclick = () => { const n = $('#myName').value.trim(); if (n) run(() => rename(n), 'Đã lưu tên.'); };
      $('#signOut').onclick = () => run(signOut);
    }

    document.addEventListener('click', e => {
      if (e.target.closest('[data-open-acct]')) { view.msg = ''; renderDialog(); dlg.showModal(); }
      else if (e.target.closest('[data-close]')) dlg.close();
    });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // bấm ra ngoài để đóng
    render();
  }
})();
