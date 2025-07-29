// =================================================================================
//  員和共購酒水網 V0.35γ - Firebase 整合最終版
// =================================================================================
document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // 🔥🔥🔥 Firebase 設定區塊 🔥🔥🔥
    // =================================================================================
    const firebaseConfig = {
      apiKey: "AIzaSyBAxZOmBEEZquT623QMFWPqRA3vXAXhomc",
      authDomain: "yuanhealcohol.firebaseapp.com",
      projectId: "yuanhealcohol",
      storageBucket: "yuanhealcohol.appspot.com", // 修正: 使用 .appspot.com 格式
      messagingSenderId: "378813081392",
      appId: "1:378813081392:web:14ee47af19fb55ee380af5",
      measurementId: "G-FV4GMT8EP2"
    };

    // --- 初始化 Firebase ---
    let db, auth;
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        auth = firebase.auth();
    } catch (e) {
        console.error("Firebase 初始化失敗:", e);
        alert("Firebase 設定無效！應用程式無法連接到資料庫。請按 F12 查看控制台錯誤訊息。");
        return;
    }

    // ===== 全域變數與狀態 =====
    let appState = {
        inventory: [], members: [], activities: [], transactions: [], pendingTopUps: [],
        unsubscribeListeners: [],
    };
    let chartInstances = {};
    let currentUser = null;

    // ===== DOM 元素快取 =====
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);

    // ===== 通用工具函式 =====
    const formatDate = (date) => {
        if (date && date.toDate) return date.toDate().toLocaleString('zh-TW', { hour12: false });
        if (typeof date === 'string' || typeof date === 'number') return new Date(date).toLocaleString('zh-TW', { hour12: false });
        return '無效日期';
    };
    
    const showToast = (message, type = 'info', duration = 3000) => {
        const container = $('#toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        const typeTitle = { success: '成功', error: '錯誤', warning: '警告', info: '訊息' };
        toast.innerHTML = `<div class="toast-header"><strong>${typeTitle[type]}</strong><button type="button" class="toast-close">&times;</button></div><div>${message}</div>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        const remove = () => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        };
        toast.querySelector('.toast-close').onclick = remove;
        setTimeout(remove, duration);
    };
    
    const openModal = (modalId) => $(`#${modalId}`).classList.add('active');
    const closeModal = (modalId) => $(`#${modalId}`).classList.remove('active');

    // ===== 核心渲染邏輯 =====
    function rerenderAll() {
        populateAllSelects();
        const activePageId = $('.page.active')?.id || 'home';
        
        renderMilestones();
        
        switch(activePageId) {
            case 'home':
                renderBrandInventory();
                break;
            case 'admin':
                renderAdminDashboard();
                break;
            case 'events':
                renderEvents();
                break;
        }
    }

    // ===== Firebase 資料監聽 =====
    function setupFirebaseListeners() {
        appState.unsubscribeListeners.forEach(unsub => unsub());
        appState.unsubscribeListeners = [];

        const collections = ['inventory', 'members', 'activities', 'transactions', 'pendingTopUps'];
        collections.forEach(name => {
            const unsub = db.collection(name).onSnapshot(snapshot => {
                appState[name] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                rerenderAll();
            }, error => console.error(`讀取 ${name} 失敗:`, error));
            appState.unsubscribeListeners.push(unsub);
        });
    }

    // ===== 頁面導航 =====
    function showPage(pageId) {
        if (pageId === 'admin' && !currentUser) {
            showToast('請先登入管理員帳號', 'warning');
            openModal('adminLoginSection');
            return;
        }
        $$('.page').forEach(p => p.classList.remove('active'));
        if($(`#${pageId}`)) $(`#${pageId}`).classList.add('active');
        $$('.nav-link').forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${pageId}`));
        $('#navMenu').classList.remove('active');
        rerenderAll();
    }
    
    // ===== UI 填充 =====
    function populateAllSelects() {
        const memberOptions = appState.members.map(m => `<option value="${m.id}">${m.name} (餘額: ${m.balance})</option>`).join('');
        const beerOptions = appState.inventory.filter(i => i.stock > 0).map(i => `<option value="${i.id}">${i.brand} ${i.name} ${i.ml}ml (庫存:${i.stock}, $${i.price})</option>`).join('');
        
        $$('.member-select').forEach(sel => sel.innerHTML = `<option value="">請選擇會員</option>${memberOptions}`);
        $('#takeMemberSelect').innerHTML += '<option value="non-member">非會員</option>';
        $$('.beer-select').forEach(sel => sel.innerHTML = `<option value="">請選擇酒款</option>${beerOptions}`);

        const allBrands = [...new Set(appState.inventory.map(i => i.brand))];
        const brandOptions = allBrands.map(b => `<option value="${b}">${b}</option>`).join('');
        $$('.brand-select').forEach(sel => sel.innerHTML = `<option value="">選擇品牌</option>${brandOptions}<option value="other">其他</option>`);
        
        const allMls = [...new Set(appState.inventory.map(i => i.ml))];
        const mlOptions = allMls.map(m => `<option value="${m}">${m}ml</option>`).join('');
        $$('.ml-select').forEach(sel => sel.innerHTML = `<option value="">選擇ml數</option>${mlOptions}<option value="other">其他</option>`);
    }

    // ===== 各頁面渲染 =====
    function renderMilestones() {
        const sales = appState.transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
        $('#memberCount').textContent = appState.members.length;
        $('#totalSales').textContent = sales.toLocaleString();
        $('#totalBottles').textContent = appState.inventory.reduce((sum, i) => sum + (i.stock || 0), 0);
        $('#skuCount').textContent = appState.inventory.length;
    }

    function renderBrandInventory() {
        const container = $('#brandInventory');
        const brandGroups = appState.inventory.reduce((acc, item) => {
            acc[item.brand] = acc[item.brand] || [];
            acc[item.brand].push(item);
            return acc;
        }, {});
        const totalStockAllBrands = appState.inventory.reduce((sum, item) => sum + (item.stock || 0), 0);
        
        container.innerHTML = Object.entries(brandGroups).map(([brand, items]) => {
            const brandStock = items.reduce((sum, item) => sum + (item.stock || 0), 0);
            const percentage = totalStockAllBrands > 0 ? (brandStock / totalStockAllBrands * 100) : 0;
            return `
                <div class="brand-card">
                    <div class="brand-header">
                        <div class="brand-name">${brand}</div>
                        <div class="brand-stock">合計庫存: ${brandStock} 瓶</div>
                        <div class="brand-expand-icon">▼</div>
                    </div>
                    <div class="brand-water-level"><div class="water-level-container"><div class="water-level-fill" style="width: ${percentage}%" title="${percentage.toFixed(1)}%"></div></div></div>
                    <div class="brand-details">
                        ${items.map(item => `
                            <div class="brand-item">
                                <span>${item.name} ${item.ml}ml</span>
                                <div class="item-details"><span class="item-price">$${item.price}</span><span>庫存: ${item.stock}</span></div>
                            </div>`).join('')}
                    </div>
                </div>`;
        }).join('');
        
        container.querySelectorAll('.brand-header').forEach(header => {
            header.addEventListener('click', () => header.closest('.brand-card').classList.toggle('expanded'));
        });
    }

    // ===== 功能邏輯 =====
    
    $('#takeBeerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const memberId = $('#takeMemberSelect').value;
        const beerId = $('#takeBeerSelect').value;
        if (!memberId || !beerId) return showToast('請選擇會員和酒款', 'warning');
        
        const beer = appState.inventory.find(i => i.id === beerId);
        if (!beer || beer.stock < 1) return showToast('此酒款庫存不足', 'warning');

        const price = beer.price;
        
        if (memberId === 'non-member') {
             $('#nonMemberPayment').classList.remove('hidden');
        } else {
            const member = appState.members.find(m => m.id === memberId);
            if (!member) return showToast('會員不存在', 'error');
            if (member.balance < price) return showToast(`餘額不足 (尚需${price - member.balance}元)`, 'warning');
            
            await db.collection('members').doc(memberId).update({
                balance: firebase.firestore.FieldValue.increment(-price)
            });
        }
        
        await db.collection('inventory').doc(beerId).update({
            stock: firebase.firestore.FieldValue.increment(-1)
        });
        
        await db.collection('transactions').add({
            type: 'take', memberId, itemId: beerId, amount: price,
            itemName: `${beer.brand} ${beer.name}`,
            memberName: memberId === 'non-member' ? '非會員' : appState.members.find(m=>m.id === memberId).name,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showToast('取酒成功!', 'success');
        e.target.reset();
    });

    $('#exchangeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const memberId = $('#exchangeMemberSelect').value;
        const outBeerId = $('#exchangeOutSelect').value;
        
        const inBrand = $('#exchangeBrand').value === 'other' ? $('#exchangeBrandCustom').value.trim() : $('#exchangeBrand').value;
        const inName = $('#exchangeName').value.trim();
        const inMl = $('#exchangeMl').value === 'other' ? parseInt($('#exchangeMlCustom').value) : parseInt($('#exchangeMl').value);

        if (!memberId || !outBeerId || !inBrand || !inName || !inMl) return showToast('請完整填寫', 'warning');

        const member = appState.members.find(m => m.id === memberId);
        const outBeer = appState.inventory.find(i => i.id === outBeerId);
        if (!member || !outBeer) return showToast('資料錯誤', 'error');

        const priceDiff = outBeer.price - 30;
        if (priceDiff > 0 && member.balance < priceDiff) return showToast(`需補差價${priceDiff}元，餘額不足`, 'warning');
        
        const batch = db.batch();
        const inventoryRef = db.collection('inventory').doc(outBeerId);
        batch.update(inventoryRef, { stock: firebase.firestore.FieldValue.increment(-1) });

        if (priceDiff !== 0) {
            const memberRef = db.collection('members').doc(memberId);
            batch.update(memberRef, { balance: firebase.firestore.FieldValue.increment(-priceDiff) });
        }
        
        const newBeer = {
            brand: inBrand, name: `${inName} (換換酒)`, ml: inMl, price: 30, stock: 1, barcode: `EXCH_${Date.now()}`
        };
        const newBeerRef = db.collection('inventory').doc();
        batch.set(newBeerRef, newBeer);

        const transRef = db.collection('transactions').doc();
        batch.set(transRef, {
            type: 'exchange', memberId, outBeerId, inBeerData: newBeer, amount: priceDiff,
            itemName: `${outBeer.brand} ${outBeer.name}`, memberName: member.name,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();

        showToast(`換酒成功！${newBeer.name}已入庫`, 'success');
        e.target.reset();
        $$('.hidden').forEach(el => el.classList.add('hidden'));
    });

    let selectedAmount = 0;
    $$('.amount-btn').forEach(btn => btn.addEventListener('click', () => {
        $$('.amount-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedAmount = parseInt(btn.dataset.amount);
    }));
    $('#rechargeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const memberId = $('#rechargeMemberSelect').value;
        if (!memberId || selectedAmount === 0) return showToast('請選擇會員和金額', 'warning');
        
        const member = appState.members.find(m => m.id === memberId);
        if (!member) return;

        await db.collection('pendingTopUps').add({
            memberId, amount: selectedAmount, memberName: member.name,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'pending'
        });

        showToast(`儲值申請${selectedAmount}元已提交，待管理員核可`, 'success');
        e.target.reset();
        $$('.amount-btn').forEach(b => b.classList.remove('selected'));
        selectedAmount = 0;
    });

    let selectedQty = 0;
    $$('.qty-btn').forEach(btn => btn.addEventListener('click', (e) => {
        $$('.qty-btn').forEach(b => b.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
        selectedQty = parseInt(e.currentTarget.dataset.qty);
    }));
    $('#sellForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const memberId = $('#sellMemberSelect').value;
        const barcode = $('#sellBarcode').value.trim();
        const brand = $('#sellBrand').value === 'other' ? $('#sellBrandCustom').value.trim() : $('#sellBrand').value;
        const name = $('#sellName').value.trim();
        const ml = $('#sellMl').value === 'other' ? parseInt($('#sellMlCustom').value) : parseInt($('#sellMl').value);
        const totalPrice = parseInt($('#sellTotalPrice').value);
        const unitPrice = parseInt($('#sellUnitPrice').value);

        if (!memberId || !brand || !name || !ml || !selectedQty || (!totalPrice && !unitPrice)) return showToast('請完整填寫表單', 'warning');
        
        const member = appState.members.find(m => m.id === memberId);
        if(!member) return;

        const finalUnitPrice = unitPrice || Math.round(totalPrice / selectedQty);
        
        const existingItem = appState.inventory.find(i => i.brand === brand && i.name === name && i.ml === ml);

        if (existingItem) {
            await db.collection('inventory').doc(existingItem.id).update({
                stock: firebase.firestore.FieldValue.increment(selectedQty)
            });
        } else {
            await db.collection('inventory').add({
                brand, name, ml, price: finalUnitPrice, stock: selectedQty, barcode
            });
        }

        await db.collection('transactions').add({
            type: 'sell', memberId, amount: finalUnitPrice * selectedQty,
            itemName: `${brand} ${name}`, memberName: member.name, quantity: selectedQty,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast('賣酒登記成功，已更新庫存', 'success');
        e.target.reset();
        $$('.qty-btn').forEach(b => b.classList.remove('selected'));
        selectedQty = 0;
    });
    
    // ===== App 初始化 =====
    function init() {
        // 綁定所有靜態事件
        $$('.modal-backdrop, .modal-close').forEach(el => el.addEventListener('click', (e) => e.currentTarget.closest('.modal').classList.remove('active')));
        $$('.nav-link').forEach(link => link.addEventListener('click', (e) => { e.preventDefault(); showPage(e.target.getAttribute('href').substring(1)); }));
        $('.logo').addEventListener('click', () => showPage('home'));
        $('#mobileMenuToggle').addEventListener('click', () => $('#navMenu').classList.toggle('active'));
        
        $('#loginBtn').addEventListener('click', () => openModal('adminLoginSection'));
        $('#logoutBtn').addEventListener('click', async () => {
            await auth.signOut();
            showToast('已登出');
        });
        
        $('#adminLoginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('#adminUsername').value;
            const password = $('#adminPassword').value;
            try {
                await auth.signInWithEmailAndPassword(email, password);
                showToast('管理員登入成功', 'success');
            } catch (error) {
                showToast(`登入失敗: ${error.message}`, 'error');
            }
        });

        auth.onAuthStateChanged(user => {
            currentUser = user;
            const loggedIn = !!user;
            $('#loginStatus').textContent = user ? user.email : '未登入';
            $('#loginBtn').classList.toggle('hidden', loggedIn);
            $('#logoutBtn').classList.toggle('hidden', !loggedIn);
            $('#adminDashboard').classList.toggle('hidden', !loggedIn);
            if(loggedIn) {
                closeModal('adminLoginSection');
            }
            if (!loggedIn && $('#admin').classList.contains('active')) {
                showPage('home');
            }
        });

        setupFirebaseListeners();
        showPage('home');
    }

    init();
    
    // 將需要從 HTML on-click 呼叫的函式掛載到 window
    // 這樣 HTML 中的 onclick="window.app.someFunction()" 才能運作
    window.app = {
        showPage,
        openModal,
        closeModal
        // 如果有其他需要從 HTML 直接呼叫的函式，也加到這裡
    };
});
