import { createClient } from '@supabase/supabase-js';

window.onerror = function(message, source, lineno, colno, error) {
    const errText = `${message} (at ${source}:${lineno}:${colno})`;
    console.error(`[Global Error] ${errText}`);
    return false;
};

window.onunhandledrejection = function(event) {
    const errText = `Unhandled Rejection: ${event.reason ? event.reason.message || event.reason : 'Unknown reason'}`;
    console.error(`[Promise Error] ${errText}`);
};

let diaries = [];
let editingId = null;
let displayLimit = 10;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let activeDateFilter = null; 

let supabaseClient = null;
let currentUser = null;
let diariesLoaded = false;

function updateDebugStatus(errText = "None") {
    const userEmail = currentUser ? currentUser.email : "N/A";
    console.log(`[Debug] User: ${userEmail} | Loaded: ${diariesLoaded} | Diaries: ${diaries.length} | Error: ${errText}`);
}

function escapeHtml(string) {
  return String(string).replace(/[&<>"']/g, function (s) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': '&quot;',
      "'": '&#39;'
    }[s];
  });
}

function prevMonth(){
    currentMonth--;
    if(currentMonth < 1){ currentMonth = 12; currentYear--; }
    renderCalendar();
}

function nextMonth(){
    currentMonth++;
    if(currentMonth > 12){ currentMonth = 1; currentYear++; }
    renderCalendar();
}

function initDate() {
    const now = new Date();
    const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
    const dateStr = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')}(${dayNames[now.getDay()]})`;
    const dateInput = document.getElementById("dateInput");
    if (dateInput) dateInput.value = dateStr;
}

function parseDateString(dateText){
    const now = new Date();
    let year = now.getFullYear(), month = now.getMonth() + 1, day = now.getDate();
    const numbers = dateText.match(/\d+/g);
    if(!numbers) return { year, month, day };
    if (dateText.match(/^[月火水木金土日],/)) {
        day = Number(numbers[0]); month = Number(numbers[1]); year = Number(numbers[2]);
        return { year, month, day };
    }
    if(numbers.length >= 3){
        if(numbers[0].length === 4){ year = Number(numbers[0]); month = Number(numbers[1]); day = Number(numbers[2]); }
        else if (Number(numbers[2]) > 31) { year = Number(numbers[2]); month = Number(numbers[0]); day = Number(numbers[1]); }
        else { year = Number(numbers[0]); if(year < 100) year += 2000; month = Number(numbers[1]); day = Number(numbers[2]); }
    } else if(numbers.length === 2){ month = Number(numbers[0]); day = Number(numbers[1]); }
    return { year, month, day };
}

function sortDiariesList(list) {
    return list.sort((a, b) => {
        const aYear = Number(a.year) || 0;
        const bYear = Number(b.year) || 0;
        if (aYear !== bYear) return bYear - aYear;

        const aMonth = Number(a.month) || 0;
        const bMonth = Number(b.month) || 0;
        if (aMonth !== bMonth) return bMonth - aMonth;

        const aDay = Number(a.day) || 0;
        const bDay = Number(b.day) || 0;
        if (aDay !== bDay) return bDay - aDay;

        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
    });
}

function renderCalendar(){
    const calendar = document.getElementById("calendar");
    const header = document.getElementById("calendarHeader");
    if(!calendar || !header) return;

    header.innerText = `${currentYear}年 ${currentMonth}月`;
    calendar.innerHTML = "";
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    weekdays.forEach(wd => { calendar.innerHTML += `<div class="day day-header">${wd}</div>`; });
    
    const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const today = new Date();

    for(let i = 0; i < firstDay; i++){ calendar.innerHTML += `<div class="day" style="background:transparent; border:none; min-height:auto;"></div>`; }
    
    for(let day = 1; day <= daysInMonth; day++){
        let mood = "";
        const dayEntries = diaries.filter(d => Number(d.year) === currentYear && Number(d.month) === currentMonth && Number(d.day) === day);
        if(dayEntries.length > 0){ 
            dayEntries.sort((a,b) => {
                const aTime = a.created_at ? new Date(a.created_at).getTime() : (Number(a.id) || 0);
                const bTime = b.created_at ? new Date(b.created_at).getTime() : (Number(b.id) || 0);
                return bTime - aTime;
            });
            mood = dayEntries[0].mood; 
        }
        
        const isToday = (day === today.getDate() && currentMonth === (today.getMonth() + 1) && currentYear === today.getFullYear());
        const todayClass = isToday ? 'today-highlight' : '';

        calendar.innerHTML += `<div class="day ${todayClass}" onclick="jumpToDiary(${currentYear}, ${currentMonth}, ${day})" style="cursor:pointer;"><div>${day}</div><div class="dayMood">${mood || ''}</div></div>`;
    }
}

function clearDateFilter(shouldRender = true){
    activeDateFilter = null;
    displayLimit = 10;
    if(shouldRender) renderDiaries();
}

function jumpToDiary(y, m, d){
    const searchInput = document.getElementById("search");
    if(searchInput.value !== "") { searchInput.value = ""; }

    const found = diaries.some(entry => Number(entry.year) === y && Number(entry.month) === m && Number(entry.day) === d);
    
    if(found){
        activeDateFilter = { year: y, month: m, day: d };
        displayLimit = 10;
        renderDiaries();
        
        if (window.innerWidth < 768) {
            switchTab(2);
        }
        
        setTimeout(() => {
            const searchEl = document.getElementById("search");
            if (searchEl) searchEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

function renderDiaries(){
    const diaryList = document.getElementById("diaryList");
    const searchInput = document.getElementById("search");
    if (!diaryList || !searchInput) return;
    const search = searchInput.value.toLowerCase();
    diaryList.innerHTML = "";

    let filtered = diaries;

    if(activeDateFilter){
        filtered = filtered.filter(d => Number(d.year) === activeDateFilter.year && Number(d.month) === activeDateFilter.month && Number(d.day) === activeDateFilter.day);
        
        diaryList.innerHTML += `
        <div style="background:var(--bg-input); border-left: 4px solid var(--accent-primary); padding:12px 16px; border-radius:8px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center; border: 1px solid var(--border-color); border-left: 4px solid var(--accent-primary);">
            <span>📅 <b>${activeDateFilter.year}年${activeDateFilter.month}月${activeDateFilter.day}日</b> の日記を表示中</span>
            <button onclick="clearDateFilter()" style="margin:0; padding:6px 12px; font-size:13px;" class="btn-secondary">✖ 解除</button>
        </div>`;
    } else {
        filtered = filtered.filter(d => (d.content||"").toLowerCase().includes(search) || (d.tags||"").toLowerCase().includes(search));
    }

    // 最新順（日付の降順）にソート
    filtered = sortDiariesList(filtered);

    filtered.slice(0, displayLimit).forEach(d => {
        diaryList.innerHTML += `<div class="entry" id="entry-${d.id}">
            <div class="meta-info">
                <span class="mood">${d.mood}</span>
                ${d.weather ? `<span class="weather-text">${d.weather}</span>` : ''}
                <span class="entry-date">${d.date}</span>
            </div>
            <div class="tags">${d.tags ? d.tags.split(',').map(t => `#${t.trim()}`).join(' ') : ''}</div>
            <p style="margin-top:12px; margin-bottom:16px; white-space: pre-wrap; font-size:15px; color:#e4e4e7;">${escapeHtml(d.content || "")}</p>
            <div style="display:flex; gap:8px;" class="entry-actions">
                <button onclick="editDiary('${d.id}')" class="btn-secondary" style="padding:6px 12px; font-size:13px; margin:0;">✏ 編集</button>
                <button onclick="deleteDiary('${d.id}')" class="btn-danger" style="padding:6px 12px; font-size:13px; margin:0;">🗑 削除</button>
            </div>
        </div>`;
    });

    if(filtered.length > displayLimit){ 
        diaryList.innerHTML += `<button class="load-more" onclick="window.loadMoreDiaries()">▼ さらに表示</button>`; 
    }
}

async function saveDiary(){
    if (!supabaseClient || !currentUser) {
        alert("ログインしていません。");
        return;
    }
    const dateVal = document.getElementById("dateInput").value;
    const content = document.getElementById("content").value;
    const tags = document.getElementById("tags").value;
    const weather = document.getElementById("weather").value;
    const mood = document.getElementById("mood").value;
    
    if(!content.trim()) return;
    
    const parsed = parseDateString(dateVal);
    
    const entryData = {
        date: dateVal,
        year: parsed.year,
        month: parsed.month,
        day: parsed.day,
        content: content,
        tags: tags,
        weather: weather,
        mood: mood,
        user_id: currentUser.id
    };
    
    if(editingId){
        const { error } = await supabaseClient
            .from('diaries')
            .update(entryData)
            .eq('id', editingId);
        if (error) {
            alert("保存に失敗しました: " + error.message);
            return;
        }
        editingId = null;
        document.getElementById("inputHeader").innerText = "✍ 日記を書く";
    } else {
        const { error } = await supabaseClient
            .from('diaries')
            .insert([entryData]);
        if (error) {
            alert("保存に失敗しました: " + error.message);
            return;
        }
    }
    
    document.getElementById("content").value = ""; 
    document.getElementById("tags").value = ""; 
    document.getElementById("weather").value = ""; 
    
    initDate();
    clearDateFilter(false);
    displayLimit = 10; 
    
    await fetchDiaries();
    
    if (window.innerWidth < 768) {
        switchTab(2); // Go to List tab on Mobile
    }
}

function editDiary(id){
    const diary = diaries.find(d => String(d.id) === String(id));
    if(!diary) return;
    editingId = diary.id;
    
    document.getElementById("inputHeader").innerText = `✏ 日記を編集 (${diary.date})`;
    document.getElementById("dateInput").value = diary.date;
    document.getElementById("content").value = diary.content; 
    document.getElementById("tags").value = diary.tags; 
    document.getElementById("weather").value = diary.weather || ""; 
    document.getElementById("mood").value = diary.mood;
    
    if (window.innerWidth < 768) {
        switchTab(0);
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

async function deleteDiary(id){
    if(confirm("削除しますか？")){
        const { error } = await supabaseClient
            .from('diaries')
            .delete()
            .eq('id', id);
        if (error) {
            alert("削除に失敗しました: " + error.message);
        } else {
            await fetchDiaries();
        }
    }
}

function exportDiary(){
    if(diaries.length === 0){
        alert("エクスポートする日記があらへんで！");
        return;
    }
    let text = "";
    diaries.forEach(d => {
        text += `${d.date}\n`;
        if(d.tags) text += `#${d.tags}\n`;
        
        let icons = [];
        if(d.weather) icons.push(d.weather);
        if(d.mood && d.mood !== "😐") icons.push(d.mood);
        if(icons.length > 0) text += `${icons.join(" ")}\n`;
        
        text += `\n${d.content}\n`;
        text += `\n----------------------------------------\n\n`;
    });

    const blob = new Blob([text], {type: "text/plain"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    
    const now = new Date();
    const dateStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}`;
    a.download = `DailyLog_Export_${dateStr}.txt`;
    
    a.click();
    URL.revokeObjectURL(url);
}

async function importDiary(event){
    if (!supabaseClient || !currentUser) {
        alert("ログインしていません。");
        return;
    }
    const file = event.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async function(e){
        const blocks = e.target.result.split(/\n(?=(?:[月火水木金土日],|\d{4}\/\d{2}\/\d{2}))/);
        const entriesToInsert = [];
        blocks.forEach(block => {
            const lines = block.trim().split("\n"); if(lines.length < 2) return;
            const dateLine = lines[0] || ""; 
            let tags = "", contentStart = 1;
            if(lines[1] && lines[1].startsWith("#")){ tags = lines[1].replace(/#/g,"").trim(); contentStart = 2; }
            let weather = "";
            while(contentStart < lines.length && lines[contentStart].trim() === "") contentStart++;
            if(contentStart < lines.length){
                let firstText = lines[contentStart].trim();
                if(!/[ぁ-んァ-ヶ亜-熙]/.test(firstText) && firstText.length < 20){ weather = firstText; contentStart++; }
            }
            const content = lines.slice(contentStart).join("\n").trim();
            if(!content) return;
            const parsed = parseDateString(dateLine);
            entriesToInsert.push({
                date: dateLine,
                year: parsed.year,
                month: parsed.month,
                day: parsed.day,
                content,
                tags,
                weather,
                mood: "😐",
                user_id: currentUser.id
            });
        });
        
        if (entriesToInsert.length > 0) {
            const { error } = await supabaseClient.from('diaries').insert(entriesToInsert);
            if (error) {
                alert("インポート失敗: " + error.message);
            } else {
                await fetchDiaries();
                alert("インポート完了や！");
            }
        }
    };
    reader.readAsText(file);
}

async function clearAllData(){
    if (!supabaseClient || !currentUser) return;
    if(confirm("全消去しますか？ (Supabase上のデータもすべて削除されます)")){
        const { error } = await supabaseClient
            .from('diaries')
            .delete()
            .eq('user_id', currentUser.id);
        if (error) {
            alert("削除失敗: " + error.message);
        } else {
            diaries = [];
            clearDateFilter(false);
            renderDiaries();
            renderCalendar();
            initDate();
            alert("データを全消去しました。");
        }
    }
}

function resetLimitAndRender(){ displayLimit = 10; renderDiaries(); }

function switchTab(index) {
    const panels = ['panel-write', 'panel-calendar', 'panel-list', 'panel-settings'];
    const tabs = ['tab-write', 'tab-calendar', 'tab-list', 'tab-settings'];
    
    panels.forEach((p, idx) => {
        const panelEl = document.getElementById(p);
        const tabEl = document.getElementById(tabs[idx]);
        if (idx === index) {
            panelEl.classList.add('active-panel');
            tabEl.classList.add('active');
        } else {
            panelEl.classList.remove('active-panel');
            tabEl.classList.remove('active');
        }
    });
}

// Supabase Logic
function showSupabaseError(message) {
    const banner = document.getElementById("supabase-error-banner");
    if (banner) {
        const detailsEl = banner.querySelector(".error-details");
        if (detailsEl) {
            detailsEl.innerText = message;
        }
        banner.style.display = "block";
    }
}

function initSupabase() {
    updateDebugStatus("initSupabase started");
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    
    if (url && key) {
        try {
            updateDebugStatus("Creating Supabase client");
            supabaseClient = createClient(url, key);
            updateDebugStatus("Supabase client created, setting up listeners");
            setupAuthListener();
        } catch (e) {
            console.error("Supabase初期化失敗:", e);
            updateDebugStatus("Init error: " + e.message);
            showSupabaseError("Supabase初期化中に例外が発生しました: " + e.message);
        }
    } else {
        updateDebugStatus("No credentials in environment variables");
        console.error("Supabase URL or Key is missing in environment variables.");
        showSupabaseError("環境変数（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）が設定されていません。");
    }
}

function setupAuthListener() {
    updateDebugStatus("setupAuthListener started");
    try {
        supabaseClient.auth.onAuthStateChange((event, session) => {
            updateDebugStatus(`Auth change: ${event}`);
            handleSessionChange(session, event);
        });
        updateDebugStatus("onAuthStateChange registered");
    } catch (e) {
        console.error("setupAuthListener内エラー:", e);
        updateDebugStatus("setupAuthListener err: " + e.message);
    }
}

let isHandlingSession = false;
function handleSessionChange(session, event = null) {
    if (isHandlingSession) {
        console.log("handleSessionChangeは既に実行中のためスキップします。");
        return;
    }
    isHandlingSession = true;
    try {
        updateDebugStatus(`handleSessionChange started (event: ${event}, hasSession: ${!!session})`);
        if (session) {
            let expiresAtMs = 0;
            if (typeof session.expires_at === 'number') {
                expiresAtMs = session.expires_at < 10000000000 ? session.expires_at * 1000 : session.expires_at;
            } else if (typeof session.expires_at === 'string') {
                expiresAtMs = new Date(session.expires_at).getTime();
            }
            
            const isExpired = expiresAtMs ? (expiresAtMs < Date.now()) : false;
            if (isExpired) {
                console.log("セッションが期限切れのため、データ取得をスキップしてリフレッシュを待ちます。");
                updateDebugStatus("Session Expired (waiting refresh)");
                return;
            }

            if (currentUser && currentUser.id === session.user.id && 
                document.getElementById("app-container").style.display === "block" && 
                diariesLoaded) {
                updateDebugStatus();
                return;
            }
            currentUser = session.user;
            document.getElementById("user-email").innerText = currentUser.email;
            document.getElementById("auth-container").style.display = "none";
            document.getElementById("app-container").style.display = "block";
            
            const localDiaries = localStorage.getItem("diaries");
            if (localDiaries) {
                try {
                    const parsed = JSON.parse(localDiaries);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        document.getElementById("migration-banner").style.display = "block";
                    } else {
                        document.getElementById("migration-banner").style.display = "none";
                    }
                } catch(e) {
                    document.getElementById("migration-banner").style.display = "none";
                }
            } else {
                document.getElementById("migration-banner").style.display = "none";
            }
            
            if (event === 'INITIAL_SESSION') {
                console.log("INITIAL_SESSION検知: データ取得を一時保留します。");
                updateDebugStatus("Session initializing...");
                return;
            }
            
            updateDebugStatus("Scheduling fetchDiaries...");
            setTimeout(() => {
                updateDebugStatus("Executing scheduled fetchDiaries...");
                fetchDiaries();
            }, 300);
        } else {
            currentUser = null;
            diariesLoaded = false;
            updateDebugStatus("Not Logged In");
            document.getElementById("auth-container").style.display = "flex";
            document.getElementById("app-container").style.display = "none";
        }
    } catch (e) {
        console.error("handleSessionChange内エラー:", e);
        updateDebugStatus("handleSessionChange err: " + e.message);
    } finally {
        isHandlingSession = false;
    }
}

async function fetchDiaries() {
    if (!supabaseClient || !currentUser) {
        updateDebugStatus("Fetch skipped (no client/user)");
        return;
    }
    const { data, error } = await supabaseClient
        .from('diaries')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
    if (error) {
        console.error("データ取得エラー:", error);
        updateDebugStatus(error.message);
        const diaryList = document.getElementById("diaryList");
        if (diaryList) {
            diaryList.innerHTML = `
                <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid var(--accent-danger); color: #fca5a5; padding: 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; margin-top: 16px;">
                    <strong>⚠️ データの取得に失敗しました</strong><br>
                    Supabaseのデータベースに <code>diaries</code> テーブルが作成されていない可能性があります。<br>
                    SQLエディタでテーブル作成用SQLを実行したかご確認ください。<br>
                    <span style="display:block; font-size:11px; margin-top:8px; color: var(--text-secondary);">エラー詳細: ${escapeHtml(error.message)}</span>
                </div>
            `;
        }
    } else {
        diaries = sortDiariesList(data);
        diariesLoaded = true;
        updateDebugStatus();
        renderDiaries();
        renderCalendar();
    }
}

async function handleEmailAuth(type) {
    if (!supabaseClient) {
        showAuthMessage("Supabaseクライアントが初期化されていないため、認証を実行できません。", "error");
        return;
    }
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const msgArea = document.getElementById("auth-msg-area");
    
    if (msgArea) {
        msgArea.style.display = "none";
        msgArea.innerText = "";
    }
    
    if (!email || !password) {
        showAuthMessage("メールアドレスとパスワードを入力してください。", "error");
        return;
    }
    
    try {
        if (type === 'signup') {
            showAuthMessage("登録処理を実行中...", "info");
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: window.location.origin + window.location.pathname
                }
            });
            if (error) {
                showAuthMessage("新規登録エラー: " + error.message, "error");
            } else {
                showAuthMessage("確認メールを送信しました！メールボックスをご確認 of うえ、リンクをクリックして登録を完了してください。", "success");
            }
        } else {
            showAuthMessage("ログイン処理を実行中...", "info");
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });
            if (error) {
                showAuthMessage("ログインエラー: " + error.message, "error");
            }
        }
    } catch(e) {
        showAuthMessage("認証エラー: " + e.message, "error");
    }
}

function showAuthMessage(msg, type) {
    const msgArea = document.getElementById("auth-msg-area");
    if (!msgArea) return;
    
    msgArea.innerText = msg;
    msgArea.style.display = "block";
    
    if (type === "error") {
        msgArea.style.background = "rgba(239, 68, 68, 0.15)";
        msgArea.style.border = "1px solid var(--accent-danger)";
        msgArea.style.color = "#fca5a5";
    } else if (type === "success") {
        msgArea.style.background = "rgba(16, 185, 129, 0.15)";
        msgArea.style.border = "1px solid var(--accent-success)";
        msgArea.style.color = "#a7f3d0";
    } else { // info
        msgArea.style.background = "rgba(99, 102, 241, 0.15)";
        msgArea.style.border = "1px solid var(--accent-primary)";
        msgArea.style.color = "#c7d2fe";
    }
}

async function signInWithGoogle() {
    if (!supabaseClient) {
        alert("Googleログインエラー: Supabaseクライアントが初期化されていません。");
        return;
    }
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + window.location.pathname
        }
    });
    if (error) alert("Googleログインエラー: " + error.message);
}

async function signOut() {
    if (confirm("ログアウトしますか？")) {
        try {
            if (supabaseClient) {
                supabaseClient.auth.signOut().catch(e => console.error("SignOut background error:", e));
            }
        } catch(e) {
            console.error("SignOut error:", e);
        }
        
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && (key.startsWith("sb-") || key.includes("auth-token"))) {
                localStorage.removeItem(key);
            }
        }
        
        location.reload();
    }
}

async function checkAndMigrateLocalData() {
    const localDiariesStr = localStorage.getItem("diaries");
    if (!localDiariesStr) return;
    try {
        const localDiaries = JSON.parse(localDiariesStr);
        if (Array.isArray(localDiaries) && localDiaries.length > 0) {
            const count = localDiaries.length;
            const confirmMigrate = confirm(`ローカルに保存されている ${count}件 の日記データが見つかりました。Supabaseへインポートして同期しますか？\n(移行後はローカルデータはクリアされます)`);
            if (confirmMigrate) {
                if (!supabaseClient) {
                    alert("データ移行に失敗しました: Supabaseクライアントが初期化されていません。");
                    return;
                }
                const entriesToInsert = localDiaries.map(d => {
                    const parsed = parseDateString(d.date);
                    return {
                        date: d.date,
                        year: d.year || parsed.year,
                        month: d.month || parsed.month,
                        day: d.day || parsed.day,
                        content: d.content || "",
                        tags: d.tags || "",
                        weather: d.weather || "",
                        mood: d.mood || "😐",
                        user_id: currentUser.id
                    };
                });
                
                const { error } = await supabaseClient.from('diaries').insert(entriesToInsert);
                if (error) {
                    alert("データ移行に失敗しました: " + error.message);
                } else {
                    localStorage.removeItem("diaries");
                    document.getElementById("migration-banner").style.display = "none";
                    alert("ローカルデータの移行に成功しました！");
                    await fetchDiaries();
                }
            }
        }
    } catch (e) {
        console.error("ローカルデータの解析に失敗しました:", e);
    }
}

// Expose globals for inline event handlers
window.handleEmailAuth = handleEmailAuth;
window.signInWithGoogle = signInWithGoogle;
window.signOut = signOut;
window.saveDiary = saveDiary;
window.editDiary = editDiary;
window.deleteDiary = deleteDiary;
window.exportDiary = exportDiary;
window.importDiary = importDiary;
window.clearAllData = clearAllData;
window.resetLimitAndRender = resetLimitAndRender;
window.switchTab = switchTab;
window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.clearDateFilter = clearDateFilter;
window.jumpToDiary = jumpToDiary;
window.checkAndMigrateLocalData = checkAndMigrateLocalData;
window.loadMoreDiaries = () => { displayLimit += 10; renderDiaries(); };

// Startup
initDate();
initSupabase();