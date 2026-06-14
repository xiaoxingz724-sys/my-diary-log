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
let displayLimit = 50;
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
    displayLimit = 50;
    if(shouldRender) renderDiaries();
}

function jumpToDiary(y, m, d){
    const searchInput = document.getElementById("search");
    if(searchInput.value !== "") { searchInput.value = ""; }

    const found = diaries.some(entry => Number(entry.year) === y && Number(entry.month) === m && Number(entry.day) === d);
    
    if(found){
        activeDateFilter = { year: y, month: m, day: d };
        displayLimit = 50;
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

    filtered.slice(0, displayLimit).forEach(d => {
        diaryList.innerHTML += `<div class="entry" id="entry-${d.id}">
            <div class="meta-info">
                <span class="mood">${d.mood}</span>
                ${d.weather ? `<span class="weather-text">${d.weather}</span>` : ''}
                <span class="entry-date">${d.date}</span>
            </div>
            <div class="tags">${d.tags ? d.tags.split(',').map(t => `#${t.trim()}`).join(' ') : ''}</div>
            <p style="margin-top:12px; margin-bottom:16px; white-space: pre-wrap; font-size:15px; color:#e4e4e7;">${escapeHtml(d.content || "")}</p>
            <div style="display:flex; gap:8px;">
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
    displayLimit = 50; 
    
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

// Startup
initDate();
initSupabase();

// Expose globals
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
window.loadMoreDiaries = () => { displayLimit += 50; renderDiaries(); };
