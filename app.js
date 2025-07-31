/* ==========================================================================
   員和共購酒水網 V0.61γ - JavaScript 應用程式
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // 🔥🔥🔥 Firebase 設定區塊 (已於 2025/07/31 更新) 🔥🔥🔥
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
        // 檢查設定是否為預留位置
        if (firebaseConfig.apiKey === "YOUR_API_KEY") {
            throw new Error("Firebase config is not set.");
        }
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        auth = firebase.auth();
        console.log("Firebase 初始化成功！");
    } catch (e) {
        console.error("Firebase 初始化失敗:", e);
        document.getElementById('firebase-config-error').classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
        return; // 中止應用程式執行
    }

    // ===== 全域狀態 =====
    let appState = {
        inventory: [], members: [], activities: [], transactions: [], 
        pendingTopUps: [], pendingSells: [],
        unsubscribe: {}
    };
    let chartInstances = {};
    let currentUser = null;
    let superAdminMode = false;
    let html5QrCode = null;
    let selectedAmount = 0;
    let selectedQty = 0;
    let currentEditingMemberId = null;
    let currentEditingInventoryId = null;
    let confirmAction = null;

    // ===== DOM 元素快取 =====
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => document.querySelectorAll(selector);

    // ===== 通用工具函式 =====
    const showToast = (message, type = 'info', duration = 3000) => {
        const container = $('#toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        const typeTitle = { success: '成功', error: '錯誤', warning: '警告', info: '訊息' };
        toast.innerHTML = `<div class="toast-header"><strong>${typeTitle[type]}</strong><button type="button" class="toast-close">&times;</button></div><div>${message}</div>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        const remove = () => {
            toast.classList.remove('show');
            setTimeout(() => { if(toast.parentNode) toast.remove() }, 400);
        };
        toast.querySelector('.toast-close').onclick = remove;
        setTimeout(remove, duration);
    };
    
    const openModal = (modalId) => $(`#${modalId}`)?.classList.add('active');
    const closeModal = (modalId) => {
        const modal = $(`#${modalId}`);
        if (modal) modal.classList.remove('active');
        if (modalId === 'scannerModal' && html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(err => console.warn("停止掃描時發生錯誤", err));
        }
    };
    
    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    // ===== 核心渲染邏輯 =====
    function rerenderAll() {
        const activePageId = $('.page.active')?.id || 'home';
        
        renderMilestones();
        populateAllSelects();
        
        switch(activePageId) {
            case 'home': renderBrandInventory(); break;
            case 'exchange': renderExchangeRecords(); break;
            case 'buy': renderTopupRecords(); break;
            case 'sell': renderSellRecords(); break;
            case 'events': renderEvents(); break;
            case 'admin': if(currentUser) renderAdminDashboard(); break;
        }
    }

    // ===== Firebase 資料監聽 =====
    function setupFirebaseListeners() {
        if (appState.unsubscribe.inventory) return; // 防止重複監聽

        const collections = ['inventory', 'members', 'activities', 'transactions', 'pendingTopUps', 'pendingSells'];
        collections.forEach(name => {
            const query = (name === 'transactions' || name === 'activities') ? db.collection(name).orderBy('timestamp', 'desc') : db.collection(name);
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
        const beerOptions = appState.inventory.filter(i => (i.stock || 0) > 0).map(i => `<option value="${i.id}" data-barcode="${i.barcode || ''}">${i.brand} ${i.name} ${i.ml}ml (庫存:${i.stock}, $${i.price})</option>`).join('');
        
        $$('.member-select').forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = `<option value="">請選擇會員</option>${memberOptions}`;
            if (sel.id === 'takeMemberSelect') sel.innerHTML += '<option value="non-member">非會員</option>';
            if (sel.id === 'transactionMemberFilter') sel.innerHTML = `<option value="all">所有會員</option>${memberOptions}`;
            if(appState.members.find(m => m.id === currentVal) || currentVal === 'all' || currentVal === 'non-member') sel.value = currentVal;
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
        const sales = appState.transactions
            .filter(t => ['take', 'event_settlement', 'event_fee'].includes(t.type))
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
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
        }).join('') || '<p>目前沒有庫存資料。</p>';
    }

    function renderMemberRecords(containerId, records, type) {
        const container = $(`#${containerId}`);
        if (!container) return;

        const memberGroups = {};
        appState.members.forEach(m => {
            memberGroups[m.id] = { name: m.name, room: m.room, records: [], total: 0, types: new Set() };
        });

        records.forEach(r => {
            const memberId = r.memberId;
            if (memberGroups[memberId]) {
                memberGroups[memberId].records.push(r);
                if (type === 'topup') memberGroups[memberId].total += r.amount;
                if (type === 'exchange') memberGroups[memberId].total += 1;
                if (type === 'sell') {
                    const sellAmount = r.item?.price * r.item?.stock || 0;
                    memberGroups[memberId].total += sellAmount;
                    memberGroups[memberId].types.add(`${r.item.brand}-${r.item.name}`);
                }
            }
        });
        
        let sortedMembers = Object.values(memberGroups).filter(g => g.records.length > 0 || (type === 'topup' && appState.members.find(m => m.name === g.name)));
        
        if (type === 'sell') {
             sortedMembers.sort((a,b) => b.types.size - a.types.size);
        } else {
             sortedMembers.sort((a,b) => b.total - a.total);
        }
        
        const maxVal = sortedMembers.length > 0 ? sortedMembers[0].total : 0;
        const maxTypes = type === 'sell' && sortedMembers.length > 0 ? sortedMembers[0].types.size : 0;

        container.innerHTML = sortedMembers.map(group => {
            let progress = 0, summaryText = '';
            if (type === 'sell') {
                progress = maxTypes > 0 ? (group.types.size / maxTypes * 100) : 0;
                summaryText = `銷售種類: ${group.types.size} 種`;
            } else {
                progress = maxVal > 0 ? (group.total / maxVal * 100) : 0;
                summaryText = type === 'topup' ? `總儲值: $${group.total.toLocaleString()}` : `總換酒: ${group.total} 次`;
            }
            
            return `
            <div class="record-card">
                <div class="record-card-header">
                    <div class="record-card-header-main">
                        <span class="record-card-title">${group.name}</span>
                        <span class="record-card-summary">${summaryText}</span>
                    </div>
                    <div class="record-card-progress-bar">
                        <div class="record-card-progress" style="width: ${progress}%"></div>
                    </div>
                </div>
                <div class="record-card-details">
                    <div class="record-details-list">
                    ${group.records.slice(0, 5).map(r => {
                        let detailText = '';
                        if (type === 'topup') detailText = `儲值 $${r.amount.toLocaleString()}`;
                        if (type === 'exchange') detailText = `換出: ${r.itemName.split('/')[0].split(':')[1]}`;
                        if (type === 'sell') detailText = `賣出: ${r.item.brand} ${r.item.name} x${r.item.stock}`;
                        return `<div class="record-detail-item"><span>${formatDate(r.timestamp)} - ${detailText}</span></div>`;
                    }).join('')}
                    </div>
                </div>
            </div>`;
        }).join('') || '<p>尚無相關紀錄。</p>';
    }

    function renderExchangeRecords() { renderMemberRecords('exchangeRecords', appState.transactions.filter(t => t.type === 'exchange'), 'exchange'); }
    function renderTopupRecords() { renderMemberRecords('topupRecords', appState.transactions.filter(t => t.type === 'recharge'), 'topup'); }
    function renderSellRecords() { renderMemberRecords('sellRecords', appState.pendingSells.filter(s => s.status === 'approved'), 'sell'); }
    
    function renderAdminDashboard() {
        renderPendingTopUps();
        renderPendingSells();
        renderMembersTable();
        renderInventoryTable();
        renderAdminCharts();
        renderTransactionsTable();
        renderFinancialOverview();
    }

    function renderPendingTopUps() {
        const container = $('#pendingTopUps');
        if (!container) return;
        const pending = appState.pendingTopUps.filter(p => p.status === 'pending');
        if (pending.length === 0) {
            container.innerHTML = '<p>沒有待核可的儲值申請。</p>'; return;
        }
        container.innerHTML = pending.map(p => `
            <div class="approval-card">
                <p><strong>${p.memberName}</strong> 申請儲值 <strong>$${p.amount}</strong></p>
                <small>${formatDate(p.timestamp)}</small>
                <div class="approval-actions">
                    <button class="btn btn--sm btn--primary" data-approve-id="${p.id}">核可</button>
                    <button class="btn btn--sm btn--outline" data-reject-id="${p.id}">拒絕</button>
                </div>
            </div>`).join('');
    }

    function renderPendingSells() {
        const container = $('#pendingSells');
        if (!container) return;
        const pending = appState.pendingSells.filter(p => p.status === 'pending');
        if (pending.length === 0) {
            container.innerHTML = '<p>沒有待核可的賣酒申請。</p>'; return;
        }
        container.innerHTML = pending.map(p => `
            <div class="approval-card">
                <p><strong>${p.memberName}</strong> 申請賣 <strong>${p.item.brand} ${p.item.name} x${p.item.stock}</strong></p>
                <small>單價: $${p.item.price}</small>
                <div class="approval-actions">
                    <button class="btn btn--sm btn--primary" data-approve-sell-id="${p.id}">核可</button>
                    <button class="btn btn--sm btn--outline" data-reject-sell-id="${p.id}">拒絕</button>
                </div>
            </div>`).join('');
    }

    function renderMembersTable() {
        const tbody = $('#membersTableBody');
        if (!tbody) return;
        tbody.innerHTML = appState.members.map(m => `
            <tr>
                <td>${m.name}</td><td>${m.room}</td><td>${m.nfcId || ''}</td><td>${m.balance}</td>
                <td class="actions-cell">
                    <button class="btn btn--sm" data-edit-member-id="${m.id}">編輯</button>
                    <button class="btn btn--sm btn--danger" data-delete-member-id="${m.id}">刪除</button>
                </td>
            </tr>`).join('');
    }

    function renderInventoryTable() {
        const tbody = $('#inventoryTableBody');
        if (!tbody) return;
        tbody.innerHTML = appState.inventory.map(i => `
            <tr>
                <td>${i.brand}</td><td>${i.name}</td><td>${i.ml}</td><td>${i.price}</td><td>${i.stock}</td><td>${i.barcode || ''}</td>
                <td class="actions-cell">
                    <button class="btn btn--sm" data-edit-inventory-id="${i.id}">編輯</button>
                    <button class="btn btn--sm btn--danger" data-delete-inventory-id="${i.id}">刪除</button>
                </td>
            </tr>`).join('');
    }
    
    function renderTransactionsTable() {
        const tbody = $('#transactionsTableBody');
        if (!tbody) return;
        const filterValue = $('#transactionMemberFilter').value;
        const filtered = filterValue === 'all' ? appState.transactions : appState.transactions.filter(t => t.memberId === filterValue);
        tbody.innerHTML = filtered.map(t => `
            <tr>
                <td>${formatDate(t.timestamp)}</td><td>${t.memberName || 'N/A'}</td><td>${t.type}</td>
                <td>${t.itemName || 'N/A'}</td><td>${t.amount}</td>
            </tr>`).join('');
    }

    function renderFinancialOverview() {
        const income = appState.transactions
            .filter(t => ['take', 'event_settlement', 'event_fee'].includes(t.type))
            .reduce((sum, t) => sum + t.amount, 0);
        const expense = appState.transactions
            .filter(t => t.type === 'sell')
            .reduce((sum, t) => sum + t.amount, 0); // Assuming selling to the system is an expense
        $('#totalIncome').textContent = `$${income.toLocaleString()}`;
        $('#totalExpense').textContent = `$${expense.toLocaleString()}`;
        $('#netProfit').textContent = `$${(income - expense).toLocaleString()}`;
    }

    function renderAdminCharts() {
        Object.values(chartInstances).forEach(chart => chart.destroy());
        chartInstances = {};

        const popularItemsCtx = $('#popularItemsChart')?.getContext('2d');
        if (popularItemsCtx) {
            const salesData = {};
            appState.transactions.filter(t => t.type === 'take').forEach(t => { salesData[t.itemName] = (salesData[t.itemName] || 0) + 1; });
            const sortedSales = Object.entries(salesData).sort((a, b) => b[1] - a[1]).slice(0, 5);
            chartInstances.popularItems = new Chart(popularItemsCtx, {
                type: 'bar', data: { labels: sortedSales.map(i => i[0]), datasets: [{ label: '銷售瓶數', data: sortedSales.map(i => i[1]), backgroundColor: 'rgba(139, 0, 0, 0.7)' }] }
            });
        }

        const memberSpendingCtx = $('#memberSpendingChart')?.getContext('2d');
        if (memberSpendingCtx) {
            const spendingData = {};
            appState.transactions.forEach(t => { if (t.memberName !== '非會員' && t.amount > 0) spendingData[t.memberName] = (spendingData[t.memberName] || 0) + t.amount; });
            const sortedSpending = Object.entries(spendingData).sort((a, b) => b[1] - a[1]).slice(0, 5);
            chartInstances.memberSpending = new Chart(memberSpendingCtx, {
                type: 'pie', data: { labels: sortedSpending.map(i => i[0]), datasets: [{ data: sortedSpending.map(i => i[1]), backgroundColor: ['#8B0000', '#FFBF00', '#c68a4b', '#a52a2a', '#412c00'] }] }
            });
        }

        const fundCtx = $('#fundChart')?.getContext('2d');
        if(fundCtx) {
            const dataByMonth = {};
            appState.transactions.forEach(t => {
                if (!t.timestamp) return;
                const date = t.timestamp.toDate();
                const month = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
                const income = ['take', 'event_settlement', 'event_fee', 'recharge'].includes(t.type) ? t.amount : 0;
                const expense = 0; // Simplified for now
                dataByMonth[month] = dataByMonth[month] || { income: 0, expense: 0 };
                dataByMonth[month].income += income;
                dataByMonth[month].expense += expense;
            });
            const labels = Object.keys(dataByMonth).sort();
            let runningTotal = 0;
            const fundData = labels.map(month => {
                runningTotal += dataByMonth[month].income - dataByMonth[month].expense;
                return runningTotal;
            });
            chartInstances.fundChart = new Chart(fundCtx, {
                type: 'line', data: { labels, datasets: [{ label: '基金餘額', data: fundData, borderColor: 'rgba(17, 94, 89, 1)', tension: 0.1 }] }
            });
        }
    }
    
    function renderEvents() {
        const container = $('#eventsGrid');
        if (!container) return;
        container.innerHTML = (appState.activities || []).map(event => {
            const isFull = (event.participants?.length || 0) >= event.capacity;
            const isEnded = event.timestamp.toDate() < new Date();
            return `
            <div class="event-card">
                <div class="event-card__header"><h3>${event.title}</h3></div>
                <div class="event-card__body">
                    <p><strong>時間:</strong> ${formatDate(event.timestamp)}</p>
                    <p><strong>地點:</strong> ${event.location}</p>
                    <p><strong>人數:</strong> ${event.participants?.length || 0} / ${event.capacity}</p>
                    <p><strong>費用:</strong> ${event.feeType === '前扣' ? `$${event.feeAmount}/人` : '後扣'}</p>
                    <p>${event.description}</p>
                    <p><strong>參與者:</strong> ${(event.participantNames || []).join(', ') || '尚無人報名'}</p>
                    ${currentUser ? `
                    <div class="event-admin-actions">
                        ${!isEnded && event.feeType === '後扣' ? `<button class="btn btn--sm btn--primary" data-settle-event-id="${event.id}">結算</button>` : ''}
                        <button class="btn btn--sm btn--danger" data-delete-event-id="${event.id}">刪除</button>
                    </div>` : ''}
                </div>
                <div class="event-card__footer">
                    <button class="btn btn--primary" data-join-event-id="${event.id}" ${isFull || isEnded ? 'disabled' : ''}>${isEnded ? '已結束' : isFull ? '已額滿' : '我要報名'}</button>
                    <button class="btn btn--secondary" data-share-event-id="${event.id}">分享</button>
                </div>
            </div>`;
        }).join('') || '<p>目前沒有任何活動。</p>';
    }
    
    // ===== Action Handlers & Logic =====
    async function handleAdminLogin(e) {
        e.preventDefault();
        try {
            await auth.signInWithEmailAndPassword($('#adminUsername').value, $('#adminPassword').value);
            showToast('管理員登入成功', 'success');
        } catch (error) {
            showToast('帳號或密碼錯誤', 'error');
        }
    }

    async function handleTakeBeer(e) {
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
                if (member.balance < price) return showToast(`餘額不足 (尚需${price - member.balance}元)`, 'warning');
                await db.collection('members').doc(memberId).update({ balance: firebase.firestore.FieldValue.increment(-price) });
            } else {
                $('#nonMemberPayment').classList.remove('hidden');
            }
            
            await db.collection('inventory').doc(beerId).update({ stock: firebase.firestore.FieldValue.increment(-1) });
            
            const memberName = memberId === 'non-member' ? '非會員' : appState.members.find(m=>m.id === memberId).name;
            await db.collection('transactions').add({
                type: 'take', memberId, memberName, itemId: beerId, amount: price,
                itemName: `${beer.brand} ${beer.name} ${beer.ml}ml`,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            showToast('取酒成功!', 'success');
            e.target.reset();
        } catch (error) { showToast('操作失敗，請稍後再試', 'error'); }
    }
    
    async function handleRecharge(e) {
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
    }

    async function handleMemberFormSubmit(e) {
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
        $('#memberFormTitle').textContent = '新增會員';
        $('#cancelEditMemberBtn').classList.add('hidden');
    }

    async function handleInventoryFormSubmit(e) {
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
        $('#inventoryFormTitle').textContent = '新增酒水';
        $('#cancelEditInventoryBtn').classList.add('hidden');
    }

    async function handleExchange(e) {
        e.preventDefault();
        const memberId = $('#exchangeMemberSelect').value;
        const outBeerId = $('#exchangeOutSelect').value;
        let inBeerBrand = $('#exchangeBrand').value;
        if (inBeerBrand === 'other') inBeerBrand = $('#exchangeBrandCustom').value.trim();
        const inBeerName = $('#exchangeName').value.trim();
        let inBeerMl = $('#exchangeMl').value;
        if (inBeerMl === 'other') inBeerMl = $('#exchangeMlCustom').value.trim();
        
        if (!memberId || !outBeerId || !inBeerBrand || !inBeerName || !inBeerMl) return showToast('請填寫所有必填欄位', 'warning');

        const member = appState.members.find(m => m.id === memberId);
        const outBeer = appState.inventory.find(i => i.id === outBeerId);

        if (!member || !outBeer || outBeer.stock < 1) return showToast('會員不存在或換出酒款庫存不足', 'error');
        
        const priceDiff = outBeer.price - 30;
        if (priceDiff > 0 && member.balance < priceDiff) {
            return showToast(`餘額不足以支付差價 $${priceDiff}`, 'warning');
        }

        try {
            const batch = db.batch();
            const memberRef = db.collection('members').doc(memberId);
            if (priceDiff > 0) {
                batch.update(memberRef, { balance: firebase.firestore.FieldValue.increment(-priceDiff) });
            }

            const outBeerRef = db.collection('inventory').doc(outBeerId);
            batch.update(outBeerRef, { stock: firebase.firestore.FieldValue.increment(-1) });

            const inBeerRef = db.collection('inventory').doc();
            batch.set(inBeerRef, {
                brand: inBeerBrand, name: `${inBeerName} (換換酒)`, ml: inBeerMl,
                price: 30, stock: 1, barcode: `EXCHANGE_${Date.now()}`
            });

            const transactionRef = db.collection('transactions').doc();
            batch.set(transactionRef, {
                type: 'exchange', memberId, memberName: member.name,
                itemName: `換出:${outBeer.name} / 換入:${inBeerName}`,
                amount: priceDiff > 0 ? priceDiff : 0,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();
            showToast('換酒成功!', 'success');
            e.target.reset();
        } catch (error) { showToast('操作失敗', 'error'); }
    }

    async function handleSell(e) {
        e.preventDefault();
        const memberId = $('#sellMemberSelect').value;
        let brand = $('#sellBrand').value;
        if (brand === 'other') brand = $('#sellBrandCustom').value;
        const name = $('#sellName').value;
        let ml = $('#sellMl').value;
        if (ml === 'other') ml = $('#sellMlCustom').value;
        const totalPrice = Number($('#sellTotalPrice').value);
        const unitPrice = Number($('#sellUnitPrice').value);

        if (!memberId || !brand || !name || !ml || selectedQty === 0 || (!totalPrice && !unitPrice)) {
            return showToast('請填寫所有必填欄位', 'warning');
        }

        const member = appState.members.find(m => m.id === memberId);
        if (!member) return;
        
        const finalUnitPrice = unitPrice || (totalPrice / selectedQty);

        await db.collection('pendingSells').add({
            memberId, memberName: member.name,
            item: { brand, name, ml, price: finalUnitPrice, stock: selectedQty, barcode: $('#sellBarcode').value || '' },
            status: 'pending',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        showToast('賣酒申請已提交，待管理員核可', 'success');
        e.target.reset();
        $$('.qty-btn').forEach(b => b.classList.remove('selected'));
        selectedQty = 0;
    }

    async function handleCreateEvent(e) {
        e.preventDefault();
        const creatorSelect = $('#eventCreatorSelect');
        const formData = {
            creatorId: creatorSelect.value,
            creatorName: creatorSelect.options[creatorSelect.selectedIndex].text.split(' ')[0],
            timestamp: firebase.firestore.Timestamp.fromDate(new Date($('#eventDateTime').value)),
            title: $('#eventTitle').value,
            location: $('#eventLocation').value,
            capacity: Number($('#eventCapacity').value),
            feeType: $('#eventFeeType').value,
            feeAmount: Number($('#eventFeeAmount').value) || 0,
            description: $('#eventDescription').value,
            participants: [],
            participantNames: []
        };
        await db.collection('activities').add(formData);
        showToast('活動建立成功!', 'success');
        e.target.reset();
    }
    
    async function handleEventRegister(e) {
        e.preventDefault();
        const eventId = $('#registerEventId').value;
        const memberId = $('#registerMemberSelect').value;
        
        const eventRef = db.collection('activities').doc(eventId);
        const member = appState.members.find(m => m.id === memberId);
        const event = appState.activities.find(a => a.id === eventId);
        
        if (!member || !event) return showToast('資料錯誤', 'error');
        if ((event.participants?.length || 0) >= event.capacity) return showToast('活動已額滿', 'warning');
        if (event.participants?.includes(memberId)) return showToast('您已報名', 'info');

        if (event.feeType === '前扣' && event.feeAmount > 0) {
            if (member.balance < event.feeAmount) {
                return showToast(`餘額不足，報名費 $${event.feeAmount}`, 'warning');
            }
            await db.collection('members').doc(memberId).update({ balance: firebase.firestore.FieldValue.increment(-event.feeAmount) });
        }
        
        await eventRef.update({
            participants: firebase.firestore.FieldValue.arrayUnion(memberId),
            participantNames: firebase.firestore.FieldValue.arrayUnion(member.name)
        });
        
        showToast('報名成功！', 'success');
        closeModal('eventRegisterModal');
    }
    
    async function handleEventSettlementSubmit(e) {
        e.preventDefault();
        const eventId = $('#settlementEventId').value;
        const event = appState.activities.find(a => a.id === eventId);
        if (!event || !event.participants || event.participants.length === 0) {
            return showToast('此活動沒有參與者可供結算', 'warning');
        }

        let totalCost = 0;
        const batch = db.batch();
        const consumedItems = [];

        $$('.settlement-item-row').forEach(row => {
            const beerId = row.querySelector('.beer-select').value;
            const quantity = Number(row.querySelector('input').value);
            if (beerId && quantity > 0) {
                const beer = appState.inventory.find(i => i.id === beerId);
                totalCost += beer.price * quantity;
                batch.update(db.collection('inventory').doc(beerId), { stock: firebase.firestore.FieldValue.increment(-quantity) });
                consumedItems.push(`${beer.name}x${quantity}`);
            }
        });

        if (totalCost === 0) return showToast('請至少選擇一項消費酒水', 'warning');

        const costPerPerson = Math.ceil(totalCost / event.participants.length);
        
        event.participants.forEach(memberId => {
            batch.update(db.collection('members').doc(memberId), { balance: firebase.firestore.FieldValue.increment(-costPerPerson) });
        });
        
        batch.update(db.collection('activities').doc(eventId), { status: 'settled' });
        batch.set(db.collection('transactions').doc(), {
            type: 'event_settlement',
            itemName: event.title,
            amount: totalCost,
            details: `每人扣款 $${costPerPerson}`,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        showToast(`結算完成，每人扣款 $${costPerPerson}`, 'success');
        closeModal('eventSettlementModal');
    }

    function setupEventListeners() {
        document.body.addEventListener('click', async (e) => {
            const target = e.target;
            
            // Navigation & Modals
            if (target.closest('.nav-link')) { e.preventDefault(); showPage(target.closest('.nav-link').getAttribute('href').substring(1)); }
            if (target.closest('.logo')) { showPage('home'); }
            if (target.closest('#mobileMenuToggle')) { $('#navMenu').classList.toggle('active'); }
            if (target.closest('.modal-backdrop') || target.closest('.modal-close')) { closeModal(target.closest('.modal').id); }
            if (target.closest('#loginBtn')) { openModal('loginModal'); }
            if (target.closest('#logoutBtn')) { auth.signOut(); }
            if (target.matches('.tab-btn')) {
                $$('.tab-btn').forEach(b => b.classList.remove('active'));
                target.classList.add('active');
                $$('.tab-content').forEach(c => c.classList.remove('active'));
                $(`#${target.dataset.tab}Tab`).classList.add('active');
                if (target.dataset.tab === 'business') renderAdminCharts();
            }

            // Toggles
            if (target.closest('.brand-header')) { target.closest('.brand-card').classList.toggle('expanded'); }
            if (target.closest('.record-card-header')) { target.closest('.record-card').classList.toggle('expanded'); }

            // Quick Buttons
            if (target.matches('.amount-btn')) {
                selectedAmount = parseInt(target.dataset.amount);
                $$('.amount-btn').forEach(btn => btn.classList.remove('selected'));
                target.classList.add('selected');
            }
            if (target.matches('.qty-btn')) {
                selectedQty = parseInt(target.dataset.qty);
                $$('.qty-btn').forEach(btn => btn.classList.remove('selected'));
                target.classList.add('selected');
            }

            // NFC & Scan
            if (target.matches('.nfc-btn')) { /* NFC logic here */ }
            if (target.matches('.scan-btn')) { /* Scan logic here */ }

            // Actions
            if (target.dataset.approveId) { /* handleApproveTopUp */ }
            if (target.dataset.rejectId) { /* handleRejectTopUp */ }
            if (target.dataset.approveSellId) { /* handleApproveSell */ }
            if (target.dataset.rejectSellId) { /* handleRejectSell */ }
            if (target.dataset.editMemberId) { /* handleEditMember */ }
            if (target.dataset.deleteMemberId) { /* handleDelete */ }
            if (target.dataset.editInventoryId) { /* handleEditInventory */ }
            if (target.dataset.deleteInventoryId) { /* handleDelete */ }
            if (target.dataset.joinEventId) { handleJoinEvent(target.dataset.joinEventId); }
            if (target.dataset.shareEventId) { /* handleShareEvent */ }
            if (target.dataset.settleEventId) { handleSettleEvent(target.dataset.settleEventId); }
            if (target.dataset.deleteEventId) { /* handleDelete */ }

            if (target.matches('#cancelEditMemberBtn')) {
                currentEditingMemberId = null;
                $('#memberForm').reset();
                $('#memberFormTitle').textContent = '新增會員';
                target.classList.add('hidden');
            }
            if (target.matches('#cancelEditInventoryBtn')) {
                currentEditingInventoryId = null;
                $('#inventoryForm').reset();
                $('#inventoryFormTitle').textContent = '新增酒水';
                target.classList.add('hidden');
            }
            if (target.matches('#addSettlementItemBtn')) { addSettlementItemRow(); }
            if (target.matches('.remove-settlement-item-btn')) { target.parentElement.remove(); }
        });

        // Form Submissions
        $('#adminLoginForm').addEventListener('submit', handleAdminLogin);
        $('#takeBeerForm').addEventListener('submit', handleTakeBeer);
        $('#rechargeForm').addEventListener('submit', handleRecharge);
        $('#memberForm').addEventListener('submit', handleMemberFormSubmit);
        $('#inventoryForm').addEventListener('submit', handleInventoryFormSubmit);
        $('#exchangeForm').addEventListener('submit', handleExchange);
        $('#sellForm').addEventListener('submit', handleSell);
        $('#createEventForm').addEventListener('submit', handleCreateEvent);
        $('#eventRegisterForm').addEventListener('submit', handleEventRegister);
        $('#eventSettlementForm').addEventListener('submit', handleEventSettlementSubmit);

        // Dynamic Inputs
        $$('.brand-select, .ml-select').forEach(sel => sel.addEventListener('change', e => {
            const customInput = e.target.nextElementSibling;
            if (customInput && customInput.tagName === 'INPUT') {
                customInput.classList.toggle('hidden', e.target.value !== 'other');
            }
        }));
        $('#eventFeeType').addEventListener('change', e => {
            $('#eventFeeGroup').classList.toggle('hidden', e.target.value !== '前扣');
        });
    }

    // ===== App Initialization =====
    function init() {
        try {
            auth.onAuthStateChanged(user => {
                currentUser = user;
                superAdminMode = user?.email === 'alcoholic@yuanhe.com';
                document.body.classList.toggle('super-admin-mode', superAdminMode);

                const loggedIn = !!user;
                $('#loginStatus').textContent = user ? user.email.split('@')[0] : '未登入';
                $('#loginBtn').classList.toggle('hidden', loggedIn);
                $('#logoutBtn').classList.toggle('hidden', !loggedIn);
                
                if(loggedIn) {
                    closeModal('loginModal');
                    setupFirebaseListeners();
                } else {
                    if (appState.unsubscribe.inventory) {
                        Object.values(appState.unsubscribe).forEach(unsub => unsub());
                        appState.unsubscribe = {};
                    }
                    appState = { inventory: [], members: [], activities: [], transactions: [], pendingTopUps: [], pendingSells: [], siteContent: {}, unsubscribe: {} };
                    rerenderAll();
                }
                
                if (!loggedIn && $('#admin').classList.contains('active')) {
                    showPage('home');
                }
            });

            setupEventListeners(); // **CRITICAL FIX: Call the event listener setup**
            showPage('home');
        } catch (error) {
            console.error("初始化過程中發生嚴重錯誤:", error);
            showToast("系統啟動失敗，請檢查控制台錯誤。", "error");
        }
    }

    init();
});
