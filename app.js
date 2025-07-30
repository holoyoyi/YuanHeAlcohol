/* ==========================================================================
   員和共購酒水網 V0.43γ - JavaScript 應用程式 (功能完整修復版)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // 🔥🔥🔥 Firebase 設定區塊 🔥🔥🔥
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
    let currentScannerTarget = {};

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
            const query = name === 'transactions' ? db.collection(name).orderBy('timestamp', 'desc') : db.collection(name);
            appState.unsubscribe[name] = query.onSnapshot(snapshot => {
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
        const beerOptions = appState.inventory.filter(i => i.stock > 0).map(i => `<option value="${i.id}" data-barcode="${i.barcode || ''}">${i.brand} ${i.name} ${i.ml}ml (庫存:${i.stock}, $${i.price})</option>`).join('');
        
        $$('.member-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">請選擇會員</option>${memberOptions}`;
            if (sel.id === 'takeMemberSelect') sel.innerHTML += '<option value="non-member">非會員</option>';
            if (sel.id === 'transactionMemberFilter') sel.innerHTML = `<option value="all">所有會員</option>${memberOptions}`;
            if(appState.members.find(m => m.id === currentVal) || currentVal === 'all') sel.value = currentVal;
        });
        $$('.beer-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">請選擇酒款</option>${beerOptions}`;
            if(appState.inventory.find(i => i.id === currentVal)) sel.value = currentVal;
        });

        const allBrands = [...new Set(appState.inventory.map(i => i.brand))];
        const brandOptions = allBrands.map(b => `<option value="${b}">${b}</option>`).join('');
        $$('.brand-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">選擇品牌</option>${brandOptions}<option value="other">其他</option>`;
            if(allBrands.includes(currentVal)) sel.value = currentVal;
        });
        
        const allMls = [...new Set(appState.inventory.map(i => i.ml))];
        const mlOptions = allMls.map(m => `<option value="${m}">${m}</option>`).join('');
        $$('.ml-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">選擇ml數</option>${mlOptions}<option value="other">其他</option>`;
            if(allMls.includes(currentVal)) sel.value = currentVal;
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
    
    function renderAdminDashboard() {
        renderPendingTopUps();
        renderMembersTable();
        renderInventoryTable();
        renderCharts();
        renderTransactionsTable();
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
                    <button class="btn btn--sm btn--primary" data-approve-id="${p.id}" data-member-id="${p.memberId}" data-amount="${p.amount}">核可</button>
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
    
    function renderTransactionsTable() {
        const tbody = $('#transactionsTableBody');
        if (!tbody) return;
        const filterValue = $('#transactionMemberFilter').value;
        const filteredTransactions = filterValue === 'all' 
            ? appState.transactions 
            : appState.transactions.filter(t => t.memberId === filterValue);

        tbody.innerHTML = filteredTransactions.map(t => `
            <tr>
                <td>${formatDate(t.timestamp)}</td>
                <td>${t.memberName || 'N/A'}</td>
                <td>${t.type}</td>
                <td>${t.itemName || 'N/A'}</td>
                <td>${t.amount}</td>
            </tr>
        `).join('');
    }

    function renderCharts() {
        Object.values(chartInstances).forEach(chart => {
            if(chart && typeof chart.destroy === 'function') chart.destroy();
        });
        chartInstances = {};

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
                    datasets: [{ label: '銷售瓶數', data: sortedSales.map(item => item[1]), backgroundColor: 'rgba(139, 0, 0, 0.7)' }]
                }
            });
        }

        const memberSpendingCtx = $('#memberSpendingChart')?.getContext('2d');
        if (memberSpendingCtx) {
            const spendingData = {};
            appState.transactions.forEach(t => {
                if (t.memberName !== '非會員' && t.amount > 0) {
                    spendingData[t.memberName] = (spendingData[t.memberName] || 0) + t.amount;
                }
            });
            const sortedSpending = Object.entries(spendingData).sort((a, b) => b[1] - a[1]).slice(0, 5);
            chartInstances.memberSpending = new Chart(memberSpendingCtx, {
                type: 'pie',
                data: {
                    labels: sortedSpending.map(item => item[0]),
                    datasets: [{ data: sortedSpending.map(item => item[1]), backgroundColor: ['#8B0000', '#FFBF00', '#c68a4b', '#a52a2a', '#412c00'] }]
                }
            });
        }
    }
    
    function renderEvents() {
        const container = $('#eventsGrid');
        if (!container) return;
        container.innerHTML = (appState.activities || []).map(event => {
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
                    <p><strong>參與者:</strong> ${(event.participantNames || []).join(', ') || '尚無人報名'}</p>
                </div>
                <div class="event-card__footer">
                    <button class="btn btn--primary btn-join-event" data-event-id="${event.id}" ${isFull ? 'disabled' : ''}>${isFull ? '已額滿' : '我要報名'}</button>
                </div>
            </div>`;
        }).join('');
    }

    // ===== 功能邏輯與事件監聽 =====
    
    function setupEventListeners() {
        // 使用事件委派來處理所有動態和靜態元素的點擊事件
        document.body.addEventListener('click', async (e) => {
            const target = e.target;

            // 導航
            if (target.closest('.nav-link')) { e.preventDefault(); showPage(target.closest('.nav-link').getAttribute('href').substring(1)); }
            if (target.closest('.logo')) { showPage('home'); }
            if (target.closest('#mobileMenuToggle')) { $('#navMenu').classList.toggle('active'); }
            
            // 模態框
            if (target.closest('.modal-backdrop') || target.closest('.modal-close')) { closeModal(target.closest('.modal').id); }
            if (target.closest('#loginBtn')) { openModal('loginModal'); }
            if (target.closest('#logoutBtn')) { auth.signOut(); }

            // 後台頁籤
            if (target.matches('.tab-btn')) {
                $$('.tab-btn').forEach(btn => btn.classList.remove('active'));
                target.classList.add('active');
                $$('.tab-content').forEach(content => content.classList.remove('active'));
                $(`#${target.dataset.tab}Tab`).classList.add('active');
                if(target.dataset.tab === 'business') renderCharts();
            }

            // 品牌庫存摺疊
            if (target.closest('.brand-header')) {
                target.closest('.brand-card').classList.toggle('expanded');
            }
            
            // 儲值按鈕
            if (target.matches('.amount-btn')) {
                selectedAmount = parseInt(target.dataset.amount);
                $$('.amount-btn').forEach(btn => btn.classList.remove('selected'));
                target.classList.add('selected');
            }

            // 數量按鈕
            if (target.matches('.qty-btn')) {
                selectedQty = parseInt(target.dataset.qty);
                 $$('.qty-btn').forEach(btn => btn.classList.remove('selected'));
                target.classList.add('selected');
            }

            // 後台管理按鈕
            if (target.dataset.approveId) {
                const id = target.dataset.approveId;
                const memberId = target.dataset.memberId;
                const amount = parseInt(target.dataset.amount);
                await db.collection('members').doc(memberId).update({ balance: firebase.firestore.FieldValue.increment(amount) });
                await db.collection('pendingTopUps').doc(id).update({ status: 'approved' });
                showToast('儲值已核可', 'success');
            }
            if (target.dataset.rejectId) {
                await db.collection('pendingTopUps').doc(target.dataset.rejectId).update({ status: 'rejected' });
                showToast('儲值已拒絕', 'info');
            }
            if (target.dataset.editMemberId) {
                const id = target.dataset.editMemberId;
                const member = appState.members.find(m => m.id === id);
                if (member) {
                    currentEditingMemberId = id;
                    $('#memberFormTitle').textContent = '編輯會員';
                    $('#memberId').value = id;
                    $('#memberNickname').value = member.name;
                    $('#memberRoom').value = member.room;
                    $('#memberNfcCode').value = member.nfcId || '';
                    $('#memberBalance').value = member.balance;
                    $('#cancelEditMemberBtn').classList.remove('hidden');
                    $('#membersTab').scrollIntoView({behavior: 'smooth'});
                }
            }
            if (target.dataset.editInventoryId) {
                const id = target.dataset.editInventoryId;
                const item = appState.inventory.find(i => i.id === id);
                if(item) {
                    currentEditingInventoryId = id;
                    $('#inventoryFormTitle').textContent = '編輯酒水';
                    $('#inventoryItemId').value = id;
                    $('#inventoryBrand').value = item.brand;
                    $('#inventoryName').value = item.name;
                    $('#inventoryMl').value = item.ml;
                    $('#inventoryPrice').value = item.price;
                    $('#inventoryStock').value = item.stock;
                    $('#inventoryBarcode').value = item.barcode || '';
                    $('#cancelEditInventoryBtn').classList.remove('hidden');
                    $('#inventoryTab').scrollIntoView({behavior: 'smooth'});
                }
            }
            if (target.matches('#cancelEditMemberBtn')) {
                currentEditingMemberId = null;
                $('#memberForm').reset();
                $('#memberFormTitle').textContent = '新增/編輯會員';
                target.classList.add('hidden');
            }
            if (target.matches('#cancelEditInventoryBtn')) {
                currentEditingInventoryId = null;
                $('#inventoryForm').reset();
                $('#inventoryFormTitle').textContent = '新增/編輯酒水';
                target.classList.add('hidden');
            }

            // NFC & 掃碼按鈕
            if (target.matches('.nfc-btn')) {
                const selectEl = target.previousElementSibling;
                startNFCScan(selectEl);
            }
            if (target.matches('.scan-btn')) {
                const selectEl = target.previousElementSibling;
                startBarcodeScan(selectEl);
            }

            // 活動報名
            if (target.matches('.btn-join-event')) {
                const eventId = target.dataset.eventId;
                $('#registerEventId').value = eventId;
                const event = appState.activities.find(a => a.id === eventId);
                if (event) {
                    $('#eventRegisterTitle').textContent = `報名 - ${event.title}`;
                    openModal('eventRegisterModal');
                }
            }
        });

        // 表單提交
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
                    
                    await db.collection('members').doc(memberId).update({ balance: firebase.firestore.FieldValue.increment(-price) });
                } else {
                    $('#nonMemberPayment').classList.remove('hidden');
                }
                
                await db.collection('inventory').doc(beerId).update({ stock: firebase.firestore.FieldValue.increment(-1) });
                
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

            showToast(`儲值申請${selectedAmount}元已提交`, 'success');
            e.target.reset();
            $$('.amount-btn').forEach(b => b.classList.remove('selected'));
            selectedAmount = 0;
        });

        $('#memberForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = {
                name: $('#memberNickname').value,
                room: $('#memberRoom').value,
                nfcId: $('#memberNfcCode').value,
                balance: Number($('#memberBalance').value)
            };
            if (currentEditingMemberId) {
                await db.collection('members').doc(currentEditingMemberId).update(formData);
                showToast('會員資料已更新', 'success');
            } else {
                await db.collection('members').add(formData);
                showToast('會員已新增', 'success');
            }
            currentEditingMemberId = null;
            $('#memberForm').reset();
            $('#memberFormTitle').textContent = '新增/編輯會員';
            $('#cancelEditMemberBtn').classList.add('hidden');
        });

        $('#inventoryForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = {
                brand: $('#inventoryBrand').value,
                name: $('#inventoryName').value,
                ml: $('#inventoryMl').value,
                price: Number($('#inventoryPrice').value),
                stock: Number($('#inventoryStock').value),
                barcode: $('#inventoryBarcode').value
            };
             if (currentEditingInventoryId) {
                await db.collection('inventory').doc(currentEditingInventoryId).update(formData);
                showToast('庫存資料已更新', 'success');
            } else {
                await db.collection('inventory').add(formData);
                showToast('新酒款已新增', 'success');
            }
            currentEditingInventoryId = null;
            $('#inventoryForm').reset();
            $('#inventoryFormTitle').textContent = '新增/編輯酒水';
            $('#cancelEditInventoryBtn').classList.add('hidden');
        });

        $('#exchangeForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const memberId = $('#exchangeMemberSelect').value;
            const outBeerId = $('#exchangeOutSelect').value;
            const inBeerName = $('#exchangeName').value;
            
            if (!memberId || !outBeerId || !inBeerName) return showToast('請填寫所有必填欄位', 'warning');

            const member = appState.members.find(m => m.id === memberId);
            const outBeer = appState.inventory.find(i => i.id === outBeerId);

            if (!member || !outBeer) return showToast('會員或換出酒款不存在', 'error');
            if (outBeer.stock < 1) return showToast('換出酒款庫存不足', 'warning');

            let inBeerBrand = $('#exchangeBrand').value;
            if (inBeerBrand === 'other') inBeerBrand = $('#exchangeBrandCustom').value;
            
            let inBeerMl = $('#exchangeMl').value;
            if (inBeerMl === 'other') inBeerMl = $('#exchangeMlCustom').value;

            if (!inBeerBrand || !inBeerMl) return showToast('請提供新酒款的品牌和ml數', 'warning');

            try {
                const batch = db.batch();
                // 扣除庫存
                const outBeerRef = db.collection('inventory').doc(outBeerId);
                batch.update(outBeerRef, { stock: firebase.firestore.FieldValue.increment(-1) });

                // 新增換入的酒到庫存
                const inBeerRef = db.collection('inventory').doc();
                batch.set(inBeerRef, {
                    brand: inBeerBrand,
                    name: `${inBeerName} (換換酒)`,
                    ml: inBeerMl,
                    price: 30, // 換換酒固定價值30
                    stock: 1,
                    barcode: ''
                });

                // 記錄交易
                const transactionRef = db.collection('transactions').doc();
                batch.set(transactionRef, {
                    type: 'exchange',
                    memberId: member.id,
                    memberName: member.name,
                    itemName: `換出:${outBeer.brand} ${outBeer.name} / 換入:${inBeerBrand} ${inBeerName}`,
                    amount: 0, // 換酒交易金額為0
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });

                await batch.commit();
                showToast('換酒成功!', 'success');
                e.target.reset();

            } catch (error) {
                console.error("換酒失敗:", error);
                showToast('操作失敗，請稍後再試', 'error');
            }
        });

        $('#sellForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const memberId = $('#sellMemberSelect').value;
            const name = $('#sellName').value;
            const totalPrice = Number($('#sellTotalPrice').value);
            const unitPrice = Number($('#sellUnitPrice').value);

            if (!memberId || !name || selectedQty === 0 || (!totalPrice && !unitPrice)) {
                return showToast('請填寫所有必填欄位', 'warning');
            }

            const member = appState.members.find(m => m.id === memberId);
            if (!member) return;

            let brand = $('#sellBrand').value;
            if (brand === 'other') brand = $('#sellBrandCustom').value;
            
            let ml = $('#sellMl').value;
            if (ml === 'other') ml = $('#sellMlCustom').value;
            
            const finalUnitPrice = unitPrice || (totalPrice / selectedQty);

            try {
                // 賣酒直接增加庫存
                await db.collection('inventory').add({
                    brand, name, ml,
                    price: finalUnitPrice,
                    stock: selectedQty,
                    barcode: $('#sellBarcode').value || ''
                });

                // 記錄交易
                await db.collection('transactions').add({
                    type: 'sell',
                    memberId,
                    memberName: member.name,
                    itemName: `${brand} ${name} x${selectedQty}`,
                    amount: -(finalUnitPrice * selectedQty), // 賣酒對系統是支出，記為負數
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });

                showToast('賣酒登記成功，已加入庫存', 'success');
                e.target.reset();
                $$('.qty-btn').forEach(b => b.classList.remove('selected'));
                selectedQty = 0;

            } catch (error) {
                console.error("賣酒登記失敗:", error);
                showToast('操作失敗，請稍後再試', 'error');
            }
        });

        $('#createEventForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = {
                creatorId: $('#eventCreatorSelect').value,
                creatorName: $('#eventCreatorSelect').options[$('#eventCreatorSelect').selectedIndex].text.split(' ')[0],
                dateTime: firebase.firestore.Timestamp.fromDate(new Date($('#eventDateTime').value)),
                title: $('#eventTitle').value,
                location: $('#eventLocation').value,
                capacity: Number($('#eventCapacity').value),
                feeType: $('#eventFeeType').value,
                feeAmount: Number($('#eventFeeAmount').value) || 0,
                description: $('#eventDescription').value,
                participants: [],
                participantNames: []
            };

            if (!formData.creatorId || !formData.title || !formData.location || !formData.capacity) {
                return showToast('請填寫所有必填欄位', 'warning');
            }

            try {
                await db.collection('activities').add(formData);
                showToast('活動建立成功!', 'success');
                e.target.reset();
            } catch (error) {
                console.error("活動建立失敗:", error);
                showToast('操作失敗，請稍後再試', 'error');
            }
        });
    }

    // ===== App 初始化 =====
    function init() {
        auth.onAuthStateChanged(user => {
            currentUser = user;
            const loggedIn = !!user;
            $('#loginStatus').textContent = user ? user.email.split('@')[0] : '未登入';
            $('#loginBtn').classList.toggle('hidden', loggedIn);
            $('#logoutBtn').classList.toggle('hidden', !loggedIn);
            
            if(loggedIn) {
                closeModal('loginModal');
                setupFirebaseListeners();
            } else {
                Object.values(appState.unsubscribe).forEach(unsub => unsub());
                appState = { inventory: [], members: [], activities: [], transactions: [], pendingTopUps: [], unsubscribe: {} };
                rerenderAll();
            }
            
            if (!loggedIn && $('#admin').classList.contains('active')) {
                showPage('home');
            }
        });

        setupEventListeners();
        showPage('home');
    }

    init();
});
