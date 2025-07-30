/* ==========================================================================
   員和共購酒水網 V0.39γ - JavaScript 應用程式 (後台修復/功能完整版)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // 🔥🔥🔥 Firebase 設定區塊 🔥🔥🔥
    // 已依照您的要求更新
    // =================================================================================
    const firebaseConfig = {
      apiKey: "AIzaSyBAxZOmBEEZquT623QMFWPqRA3vXAXhomc",
      authDomain: "yuanhealcohol.firebaseapp.com",
      projectId: "yuanhealcohol",
      storageBucket: "yuanhealcohol.firebasestorage.app",
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

    // ===== 全域狀態 =====
    let appState = {
        inventory: [], members: [], activities: [], transactions: [], pendingTopUps: [],
        unsubscribe: {}
    };
    let chartInstances = {};
    let currentUser = null;
    let html5QrCode = null;
    let selectedAmount = 0;
    let selectedQty = 0;
    let currentEditingMemberId = null;
    let currentEditingInventoryId = null;

    // ===== DOM 元素快取 =====
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);

    // ===== 通用工具函式 =====
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
    const closeModal = (modalId) => {
        const modal = $(`#${modalId}`);
        if (modal) modal.classList.remove('active');
        if (modalId === 'scannerModal' && html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(err => console.error("停止掃描失敗", err));
        }
    };
    
    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('zh-TW', { hour12: false });
    };

    // ===== 核心渲染邏輯 =====
    function rerenderAll() {
        populateAllSelects();
        const activePageId = $('.page.active')?.id || 'home';
        
        renderMilestones();
        
        switch(activePageId) {
            case 'home': renderBrandInventory(); break;
            case 'admin': if(currentUser) renderAdminDashboard(); break;
            case 'events': renderEvents(); break;
        }
    }

    // ===== Firebase 資料監聽 =====
    function setupFirebaseListeners() {
        Object.values(appState.unsubscribe).forEach(unsub => unsub());

        const collections = ['inventory', 'members', 'activities', 'transactions', 'pendingTopUps'];
        collections.forEach(name => {
            appState.unsubscribe[name] = db.collection(name).onSnapshot(snapshot => {
                appState[name] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                rerenderAll();
            }, error => console.error(`讀取 ${name} 失敗:`, error));
        });
    }

    // ===== 頁面導航 =====
    function showPage(pageId) {
        if (pageId === 'admin' && !currentUser) {
            showToast('請先登入管理員帳號', 'warning');
            openModal('loginModal');
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
        
        $$('.member-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">請選擇會員</option>${memberOptions}`;
            if (sel.id === 'takeMemberSelect') sel.innerHTML += '<option value="non-member">非會員</option>';
            sel.value = currentVal;
        });
        $$('.beer-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">請選擇酒款</option>${beerOptions}`;
            sel.value = currentVal;
        });

        const allBrands = [...new Set(appState.inventory.map(i => i.brand))];
        const brandOptions = allBrands.map(b => `<option value="${b}">${b}</option>`).join('');
        $$('.brand-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">選擇品牌</option>${brandOptions}<option value="other">其他</option>`;
            sel.value = currentVal;
        });
        
        const allMls = [...new Set(appState.inventory.map(i => i.ml))];
        const mlOptions = allMls.map(m => `<option value="${m}">${m}</option>`).join('');
        $$('.ml-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">選擇ml數</option>${mlOptions}<option value="other">其他</option>`;
            sel.value = currentVal;
        });
    }

    // ===== 各頁面渲染 =====
    function renderMilestones() {
        const sales = appState.transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
        $('#memberCount').textContent = appState.members.length;
        $('#totalSales').textContent = sales.toLocaleString();
        $('#totalBottles').textContent = appState.inventory.reduce((sum, i) => sum + (Number(i.stock) || 0), 0);
        $('#skuCount').textContent = appState.inventory.length;
    }

    function renderBrandInventory() {
        const container = $('#brandInventory');
        if(!container) return;
        const brandGroups = appState.inventory.reduce((acc, item) => {
            acc[item.brand] = acc[item.brand] || [];
            acc[item.brand].push(item);
            return acc;
        }, {});
        const totalStockAllBrands = appState.inventory.reduce((sum, item) => sum + (Number(item.stock) || 0), 0);
        
        container.innerHTML = Object.entries(brandGroups).map(([brand, items]) => {
            const brandStock = items.reduce((sum, item) => sum + (Number(item.stock) || 0), 0);
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
                        <div class="brand-items">
                        ${items.map(item => `
                            <div class="brand-item">
                                <span>${item.name} ${item.ml}ml</span>
                                <span>$${item.price} / 庫存: ${item.stock}</span>
                            </div>`).join('')}
                        </div>
                    </div>
                </div>`;
        }).join('');
    }
    
    // ===== 後台渲染函式 (錯誤修復) =====
    function renderAdminDashboard() {
        renderPendingTopUps();
        renderMembersTable();
        renderInventoryTable();
        renderCharts();
    }

    function renderPendingTopUps() {
        const container = $('#pendingTopUps');
        if (!container) return;
        const pending = appState.pendingTopUps.filter(p => p.status === 'pending');
        if (pending.length === 0) {
            container.innerHTML = '<p>沒有待核可的儲值申請。</p>';
            return;
        }
        container.innerHTML = pending.map(p => `
            <div class="approval-card">
                <p><strong>${p.memberName}</strong> 申請儲值 <strong>$${p.amount}</strong></p>
                <small>${formatDate(p.timestamp)}</small>
                <div class="approval-actions">
                    <button class="btn btn--sm btn--primary" data-approve-id="${p.id}">核可</button>
                    <button class="btn btn--sm btn--outline" data-reject-id="${p.id}">拒絕</button>
                </div>
            </div>
        `).join('');
    }

    function renderMembersTable() {
        const tbody = $('#membersTableBody');
        if (!tbody) return;
        tbody.innerHTML = appState.members.map(m => `
            <tr>
                <td>${m.name}</td>
                <td>${m.room}</td>
                <td>${m.nfcId || ''}</td>
                <td>${m.balance}</td>
                <td><button class="btn btn--sm" data-edit-member-id="${m.id}">編輯</button></td>
            </tr>
        `).join('');
    }

    function renderInventoryTable() {
        const tbody = $('#inventoryTableBody');
        if (!tbody) return;
        tbody.innerHTML = appState.inventory.map(i => `
            <tr>
                <td>${i.brand}</td>
                <td>${i.name}</td>
                <td>${i.ml}</td>
                <td>${i.price}</td>
                <td>${i.stock}</td>
                <td>${i.barcode || ''}</td>
                <td><button class="btn btn--sm" data-edit-inventory-id="${i.id}">編輯</button></td>
            </tr>
        `).join('');
    }

    function renderCharts() {
        // 清理舊圖表
        Object.values(chartInstances).forEach(chart => {
            if(chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        });
        chartInstances = {};

        // 熱銷酒款
        const popularItemsCtx = $('#popularItemsChart')?.getContext('2d');
        if (popularItemsCtx) {
            const salesData = {};
            appState.transactions.filter(t => t.type === 'take').forEach(t => {
                salesData[t.itemName] = (salesData[t.itemName] || 0) + 1;
            });
            const sortedSales = Object.entries(salesData).sort((a, b) => b[1] - a[1]).slice(0, 5);
            chartInstances.popularItems = new Chart(popularItemsCtx, {
                type: 'bar',
                data: {
                    labels: sortedSales.map(item => item[0]),
                    datasets: [{
                        label: '銷售瓶數',
                        data: sortedSales.map(item => item[1]),
                        backgroundColor: 'rgba(139, 0, 0, 0.7)'
                    }]
                }
            });
        }

        // 會員消費排行
        const memberSpendingCtx = $('#memberSpendingChart')?.getContext('2d');
        if (memberSpendingCtx) {
            const spendingData = {};
            appState.transactions.forEach(t => {
                if (t.memberName !== '非會員') {
                    spendingData[t.memberName] = (spendingData[t.memberName] || 0) + t.amount;
                }
            });
            const sortedSpending = Object.entries(spendingData).sort((a, b) => b[1] - a[1]).slice(0, 5);
            chartInstances.memberSpending = new Chart(memberSpendingCtx, {
                type: 'pie',
                data: {
                    labels: sortedSpending.map(item => item[0]),
                    datasets: [{
                        data: sortedSpending.map(item => item[1]),
                        backgroundColor: ['#8B0000', '#FFBF00', '#c68a4b', '#a52a2a', '#412c00']
                    }]
                }
            });
        }
    }
    
    function renderEvents() {
        const container = $('#eventsGrid');
        if (!container) return;
        container.innerHTML = appState.activities.map(event => {
            const isFull = event.participants.length >= event.capacity;
            return `
            <div class="event-card">
                <div class="event-card__header"><h3>${event.title}</h3></div>
                <div class="event-card__body">
                    <p><strong>時間:</strong> ${formatDate(event.dateTime)}</p>
                    <p><strong>地點:</strong> ${event.location}</p>
                    <p><strong>人數:</strong> ${event.participants.length} / ${event.capacity}</p>
                    <p><strong>費用:</strong> ${event.feeType === '前扣' ? `$${event.feeAmount}/人` : '後扣'}</p>
                    <p>${event.description}</p>
                    <p><strong>參與者:</strong> ${event.participants.join(', ') || '尚無人報名'}</p>
                </div>
                <div class="event-card__footer">
                    <button class="btn btn--primary btn-join-event" data-event-id="${event.id}" ${isFull ? 'disabled' : ''}>${isFull ? '已額滿' : '我要報名'}</button>
                    ${currentUser ? `<div class="event-admin-actions">
                        <button class="btn btn--sm btn--outline" data-edit-event-id="${event.id}">編輯</button>
                        <button class="btn btn--sm btn--secondary" data-settle-event-id="${event.id}" ${event.feeType !== '後扣' ? 'disabled' : ''}>結算</button>
                    </div>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    // ===== 功能邏輯 =====
    
    $('#takeBeerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const memberId = $('#takeMemberSelect').value;
        const beerId = $('#takeBeerSelect').value;
        if (!memberId || !beerId) return showToast('請選擇會員和酒款', 'warning');
        
        const beer = appState.inventory.find(i => i.id === beerId);
        if (!beer || beer.stock < 1) return showToast('此酒款庫存不足', 'warning');

        const price = (memberId === 'non-member') ? 35 : 30;
        
        try {
            if (memberId !== 'non-member') {
                const member = appState.members.find(m => m.id === memberId);
                if (!member) return showToast('會員不存在', 'error');
                if (member.balance < price) return showToast(`餘額不足 (尚需${price - member.balance}元)`, 'warning');
                
                await db.collection('members').doc(memberId).update({
                    balance: firebase.firestore.FieldValue.increment(-price)
                });
            } else {
                $('#nonMemberPayment').classList.remove('hidden');
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
        } catch (error) {
            console.error("取酒失敗:", error);
            showToast('操作失敗，請稍後再試', 'error');
        }
    });

    // ... (其他功能邏輯)

    // ===== App 初始化 =====
    function init() {
        // 頁面導航
        $$('.nav-link').forEach(link => link.addEventListener('click', (e) => { e.preventDefault(); showPage(e.target.getAttribute('href').substring(1)); }));
        $('.logo').addEventListener('click', () => showPage('home'));
        $('#mobileMenuToggle').addEventListener('click', () => $('#navMenu').classList.toggle('active'));
        
        // 模態框關閉
        $$('.modal-backdrop, .modal-close').forEach(el => el.addEventListener('click', (e) => closeModal(e.currentTarget.closest('.modal').id)));
        
        // 登入/登出
        $('#loginBtn').addEventListener('click', () => openModal('loginModal'));
        $('#logoutBtn').addEventListener('click', () => auth.signOut());
        
        $('#adminLoginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('#adminUsername').value;
            const password = $('#adminPassword').value;
            try {
                await auth.signInWithEmailAndPassword(email, password);
                showToast('管理員登入成功', 'success');
            } catch (error) {
                const message = error.code.includes('wrong-password') || error.code.includes('user-not-found') ? '帳號或密碼錯誤' : '登入失敗';
                showToast(message, 'error');
            }
        });

        // 監聽認證狀態
        auth.onAuthStateChanged(async user => {
            currentUser = user;
            const loggedIn = !!user;
            $('#loginStatus').textContent = user ? user.email.split('@')[0] : '未登入';
            $('#loginBtn').classList.toggle('hidden', loggedIn);
            $('#logoutBtn').classList.toggle('hidden', !loggedIn);
            
            if(loggedIn) {
                closeModal('loginModal');
                // 移除自動建檔功能
                // await seedInitialData(); 
                setupFirebaseListeners();
            } else {
                // 登出時取消監聽並清空本地資料
                Object.values(appState.unsubscribe).forEach(unsub => unsub());
                appState = { inventory: [], members: [], activities: [], transactions: [], pendingTopUps: [], unsubscribe: {} };
                rerenderAll();
            }
            
            if (!loggedIn && $('#admin').classList.contains('active')) {
                showPage('home');
            }
        });

        // 初始顯示首頁
        showPage('home');
    }

    init();
});
