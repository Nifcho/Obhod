// Английски превод. Езикът се сменя с бутона „English“ / „Български“ (запомня се на телефона) или с ?lang=en в линка.
// Приложението си пише текстовете на български; тук те се подменят на екрана, преди да се покажат.
// Логиката и данните (имена на обекти, адреси, бележки, таблицата) не се пипат.
(function () {
  'use strict';
  var KEY = 'obhod.lang';
  var q = /[?&]lang=(en|bg)\b/i.exec(location.search);
  if (q) try { localStorage.setItem(KEY, JSON.stringify(q[1].toLowerCase())); } catch (e) {}
  var lang = 'bg';
  try { if (JSON.parse(localStorage.getItem(KEY)) === 'en') lang = 'en'; } catch (e) {}
  document.documentElement.lang = lang;

  var I = window.I18N = { lang: lang, tr: function (s) { return s; } };
  I.set = function (l) {
    try { localStorage.setItem(KEY, JSON.stringify(l === 'en' ? 'en' : 'bg')); } catch (e) {}
    var u = location.href.split('#')[0].replace(/([?&])lang=(en|bg)&?/i, '$1').replace(/[?&]$/, '');
    if (u === location.href.split('#')[0]) location.reload(); else location.replace(u);
  };
  // бутоните за езика показват другия език
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-lang]');
    if (b) { e.preventDefault(); I.set(lang === 'en' ? 'bg' : 'en'); }
  });
  function langBtns() {
    var bs = document.querySelectorAll('[data-lang]');
    for (var i = 0; i < bs.length; i++) bs[i].textContent = lang === 'en' ? 'Български' : 'English';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', langBtns); else langBtns();
  if (lang !== 'en') return;

  // ---------- речник ----------
  var D = {
    // общи
    'Обход на точките': 'Obhod – point rounds',
    'Кой си?': 'Who are you?',
    'Покажи точките': 'Show points',
    'от': 'of',
    'минати': 'done',
    'Жълти:': 'Yellow:',
    'Сини:': 'Blue:',
    'остават от': 'left of',
    'Остават': 'Left',
    'Всички': 'All',
    'Минати': 'Done',
    'По номер': 'By number',
    'По маршрута': 'By route',
    'Най-близки': 'Nearest',
    'Маршрут': 'Route',
    'Нов курс': 'New round',
    'Навигация с:': 'Navigate with:',
    'не е избрано': 'not chosen',
    'Смени': 'Change',
    'Приложението не е инсталирано.': 'The app is not installed.',
    'Инсталирай': 'Install',
    'Език / Language:': 'Language:',
    'Отметките се записват в таблицата „Обход на точките – отметки“. Точките са по картите на Екобулпак.': 'Check-offs are saved to the sheet “Обход на точките – отметки”. The points follow Ecobulpack’s maps.',
    'Кой кара днес?': 'Who is driving today?',
    'Името се записва до всяка отметка. Избира се веднъж на този телефон.': 'Your name is saved with every check-off. You choose it once on this phone.',
    'Друго име': 'Other name',
    'Запази': 'Save',
    'С какво да навигираме?': 'Navigate with which app?',
    'Изборът се запомня на този телефон. Сменя се от „Навигация с…“ в списъка.': 'The choice is remembered on this phone. Change it from “Navigate with…” in the list.',
    'Отказ': 'Cancel',
    'Изчисти': 'Clear',
    'И двата': 'Both',
    'Наряд': 'Schedule',
    'Готово': 'Done',
    'Изход': 'Sign out',
    'ПИН за наряда': 'Schedule PIN',
    'Търговският наряд се променя само от Ники и Тошко. Кодът се пита веднъж на този телефон.': 'Only Niki and Toshko can change the commercial schedule. The code is asked once on this phone.',
    'Влез': 'Sign in',
    'Колко кофи има?': 'How many bins are there?',
    'Сини': 'Blue',
    'Жълти': 'Yellow',
    'Записва се за обекта занапред и го виждат всички шофьори.': 'Saved for this site from now on – all drivers see it.',
    'Счупена кофа': 'Broken bin',
    'Жълта': 'Yellow',
    'Зелена': 'Green',
    'Синя': 'Blue',
    'Друга': 'Other',
    'Какво има (по желание)': 'What’s wrong (optional)',
    'Изпрати сигнал': 'Send report',
    'Да инсталирам ли приложението?': 'Install the app?',
    '„Обход“ ще е на началния екран и ще се отваря на цял екран като обикновено приложение.': '“Obhod” will be on your home screen and open full screen like a regular app.',
    'Не сега': 'Not now',
    'Приложението не тръгна': 'The app did not start',
    'Натисни „Презареди“. Ако пак не тръгне, снимай този екран и го прати на Ники.': 'Tap “Reload”. If it still doesn’t start, take a screenshot of this screen and send it to Niki.',
    'Презареди': 'Reload',
    'Презареждам…': 'Reloading…',
    'Без съобщение за грешка': 'No error message',
    'Грешка': 'Error',
    // надписи за екранни четци и подсказки
    'Смени шофьора': 'Change driver',
    'Карта на точките': 'Map of the points',
    'Покажи къде съм': 'Show my location',
    'Покажи всички останали точки': 'Show all remaining points',
    'Покажи маршрута': 'Show the route',
    'Скрий маршрута': 'Hide the route',
    'Дневна или нощна карта': 'Day or night map',
    'Покажи списъка': 'Show the list',
    'Скрий списъка': 'Hide the list',
    'Ден от наряда': 'Schedule day',
    'Покажи': 'Show',
    'Подреди': 'Sort',
    'Име и фамилия': 'First and last name',
    'Търси обект или напиши ново име': 'Search for a site or type a new name',
    'ПИН': 'PIN',
    'Една синя по-малко': 'One blue fewer',
    'Една синя повече': 'One more blue',
    'Една жълта по-малко': 'One yellow fewer',
    'Една жълта повече': 'One more yellow',
    'Коя кофа': 'Which bin',
    'Напр. счупен капак, липсва колело, изгоряла': 'E.g. broken lid, missing wheel, burnt',
    // бройки
    'без кофи': 'no bins',
    'бройката не се вижда': 'count not visible',
    // навигация
    'Може маршрут през няколко точки': 'Can route through several points',
    'По една точка наведнъж': 'One point at a time',
    'Картите на Huawei, по една точка наведнъж': 'Huawei’s maps, one point at a time',
    'Друго приложение': 'Another app',
    'Телефонът пита с какво да отвори': 'The phone asks which app to use',
    'Препоръчано за този телефон': 'Recommended for this phone',
    'Начало': 'Start',
    'Край': 'End',
    'Лилавата линия е приблизителният маршрут. Следващият отсечек е по-ярък.': 'The purple line is the approximate route. The next leg is brighter.',
    'Спри навигацията': 'Stop navigation',
    'Навигация – картата се върти по посоката': 'Navigation – the map turns with your heading',
    'Следвай моето местоположение': 'Follow my location',
    'Навигацията е спряна – натисни бутона за местоположение, за да я пуснеш пак.': 'Navigation stopped – tap the location button to start it again.',
    // връзка с таблицата
    'Таблицата не е свързана – отметките са само на този телефон': 'The sheet is not connected – check-offs stay on this phone only',
    'Записвам…': 'Saving…',
    'Промените в наряда чакат – скриптът в таблицата трябва да се обнови': 'Schedule changes are waiting – the sheet script needs updating',
    'Няма връзка – промените в наряда чакат': 'No connection – schedule changes are waiting',
    'Записвам наряда…': 'Saving the schedule…',
    'Сигналът за счупена кофа чака – таблицата още не го приема': 'The broken-bin report is waiting – the sheet doesn’t accept it yet',
    'Няма връзка – сигналът за счупена кофа чака': 'No connection – the broken-bin report is waiting',
    'Изпращам сигнала…': 'Sending the report…',
    'Няма връзка с таблицата': 'No connection to the sheet',
    'Общи отметки · на живо': 'Shared check-offs · live',
    'Свързване…': 'Connecting…',
    'Всички са минати': 'All done',
    // търговски наряд
    'Не е днес': 'Not today',
    'Няма наряд': 'No schedule',
    'Промени': 'Edit',
    'Обнови наряда от таблицата': 'Refresh the schedule from the sheet',
    '↻ вграден': '↻ built-in',
    'добавен': 'added',
    'ти': 'you',
    'по заявка': 'on request',
    'счупена': 'broken',
    'Има телефон': 'Has a phone number',
    'без точка на картата': 'no map point',
    'записва се…': 'saving…',
    'изпраща се…': 'sending…',
    'Днес': 'Today',
    // картата с точката
    'Избрана точка': 'Selected point',
    'Следващ по наряда': 'Next on the schedule',
    'Следваща по маршрута': 'Next on the route',
    'Най-близо': 'Nearest',
    'Следваща': 'Next',
    'Всички точки в маршрута са минати. Натиснете „Нов курс“ преди следващия обход.': 'All points on this route are done. Tap “New round” before the next round.',
    'Всички обекти от наряда са минати.': 'All sites on the schedule are done.',
    'Добави обекти за деня': 'Add sites for the day',
    'Тук си': 'You’re here',
    'Затвори ×': 'Close ×',
    'Върни': 'Undo',
    'Минах': 'Done',
    'Навигация': 'Navigate',
    'Кофи': 'Bins',
    'няма': 'none',
    'Счупена': 'Broken',
    // списъкът
    'Задръж и плъзни, за да смениш реда': 'Hold and drag to change the order',
    'Няма обекти в този наряд.': 'No sites on this schedule.',
    'Няма точки.': 'No points.',
    'Всички точки са минати.': 'All points are done.',
    'Още няма минати точки.': 'No points done yet.',
    'Сигурно? Запази': 'Sure? Save',
    'Задръж': 'Hold',
    'и плъзни обекта, за да смениш реда на каране.': 'and drag a site to change the driving order.',
    'За смяна на реда избери „По номер“.': 'To change the order, choose “By number”.',
    'Редът на каране се сменя с плъзгане – първо въведи ПИН кода си.': 'Change the driving order by dragging – enter your PIN first.',
    'Въведи ПИН': 'Enter PIN',
    // съобщения
    'Първо изберете кой сте.': 'First choose who you are.',
    'Няма достъп до местоположението. Разрешете го от настройките на браузъра.': 'No access to your location. Allow it in the browser settings.',
    'Изчаквам местоположението…': 'Waiting for your location…',
    'Готово – задръж точките вляво от обекта и го плъзни.': 'Done – hold the dots to the left of a site and drag it.',
    'Няма достъп до местоположението. Разрешете го за този сайт от настройките на браузъра.': 'No access to your location. Allow it for this site in the browser settings.',
    'Търся местоположението…': 'Looking for your location…',
    'Картата следва колата. Натисни пак за навигация.': 'The map follows the car. Tap again for navigation.',
    'Навигация: картата се върти по посоката на движение.': 'Navigation: the map turns with the direction of travel.',
    'Картата следва колата (север е горе).': 'The map follows the car (north up).',
    'Маршрутът е показан.': 'Route shown.',
    'Маршрутът е скрит.': 'Route hidden.',
    'Изберете коя кофа е счупена или напишете бележка.': 'Choose which bin is broken or write a note.',
    'Таблицата не е свързана – сигналът остава само на този телефон.': 'The sheet is not connected – the report stays on this phone only.',
    'Сигналът е изпратен – Ники ще получи известие.': 'Report sent – Niki will get a notification.',
    'Дневна карта': 'Day map',
    'Нощна карта': 'Night map',
    'Чукни веднъж по картата – отваря се на цял екран. Точките се връщат от лентата долу.': 'Tap the map once to open it full screen. Bring the points back from the bar at the bottom.',
    // промени в наряда
    'В наряда': 'On the schedule',
    'Махнати': 'Removed',
    'Нов обект': 'New site',
    'Добави': 'Add',
    'Махни': 'Remove',
    'махнат': 'removed',
    'точката е тук, където съм': 'the point is here, where I am',
    'без точка на картата (няма местоположение)': 'no map point (no location)',
    'Няма такъв обект.': 'No such site.',
    'не е включен сам – добави го, ако има заявка': 'not included by default – add it if there is a request',
    'За друг обект или нов по заявка – напиши името горе. Редът на каране се сменя в списъка („По номер“) – задръж точките вляво от обекта и го плъзни.': 'For another site, or a new one on request, type the name above. The driving order is changed in the list (“By number”) – hold the dots to the left of a site and drag it.',
    'Излязохте – нарядът се променя само с ПИН.': 'Signed out – the schedule can only be changed with a PIN.',
    'Таблицата не е свързана – ПИН кодът не може да се провери.': 'The sheet is not connected – the PIN can’t be checked.',
    'Проверявам…': 'Checking…',
    'Скриптът в таблицата трябва да се обнови, за да работят ПИН кодовете.': 'The sheet script needs updating for PINs to work.',
    'Грешен ПИН.': 'Wrong PIN.',
    'Въведи ПИН кода си': 'Enter your PIN',
    'Назад': 'Back',
    'Обнови приложението': 'Refresh the app',
    'Обновявам…': 'Updating…',
    'Приложението е обновено.': 'The app is up to date.',
    'Няма интернет – опитай пак, когато има връзка.': 'No internet – try again when you have a connection.',
    'Няма връзка – опитай пак, когато има интернет.': 'No connection – try again when you have internet.',
    'ПИН кодът не е валиден – промените в наряда не са записани.': 'The PIN is not valid – schedule changes were not saved.',
    'Таблицата не отговаря. Опитайте пак.': 'The sheet is not responding. Try again.',
    'Няма връзка с таблицата. Опитайте пак.': 'No connection to the sheet. Try again.',
    // инсталиране (в приложението)
    'Приложението е инсталирано – вече е на началния екран.': 'The app is installed – it’s on your home screen now.',
    'Натиснете бутона „Сподели“ (квадратче със стрелка нагоре) в долната лента.': 'Tap the “Share” button (a square with an up arrow) in the bottom bar.',
    'Изберете „Добави към началния екран“.': 'Choose “Add to Home Screen”.',
    'Натиснете „Добави“.': 'Tap “Add”.',
    'Отворете менюто на браузъра (трите точки или чертички).': 'Open the browser menu (three dots or lines).',
    'Изберете „Инсталирай приложението“ или „Добави към началния екран“.': 'Choose “Install app” or “Add to Home screen”.',
    'Потвърдете.': 'Confirm.',
    'Така „Обход“ ще е на началния екран и ще се отваря на цял екран:': 'This puts “Obhod” on your home screen and opens it full screen:',
    'В браузъра на Samsung телефонът спира инсталирането („Блокирано е небезопасно приложение“). Отворете „Обход“ в Chrome – оттам се инсталира с едно натискане.': 'In the Samsung browser the phone blocks the install (“Unsafe app blocked”). Open “Obhod” in Chrome – it installs from there with one tap.',
    'Отвори в Chrome': 'Open in Chrome',
    'Разбрах': 'Got it',
    // страницата за инсталиране
    'Инсталирай „Обход“': 'Install “Obhod”',
    'Приложението за шофьорите на Алара – точките по маршрута, навигация и отметки „Минах“.': 'The app for Alara’s drivers – route points, navigation and “Done” check-offs.',
    'Подготвям инсталирането…': 'Getting the install ready…',
    'След това „Обход“ е на началния екран като обикновено приложение.': 'After that, “Obhod” is on your home screen like a regular app.',
    'Инсталиране от менюто': 'Install from the menu',
    'Натисни менюто горе вдясно': 'Tap the menu in the top right',
    'Избери': 'Choose',
    '„Инсталиране на приложението“': '“Install app”',
    'или': 'or',
    '„Добавяне към началния екран“': '“Add to Home screen”',
    'Потвърди с': 'Confirm with',
    '„Инсталиране“': '“Install”',
    'Ако в менюто няма такъв ред, отвори линка в Chrome:': 'If the menu has no such item, open the link in Chrome:',
    'Линкът е отворен в': 'The link is open in',
    'приложението за съобщения': 'the messaging app',
    '– оттам не може да се инсталира. Натисни бутона – ще се отвори в Chrome, после натисни „Инсталирай“.': '– it can’t be installed from there. Tap the button – it opens in Chrome, then tap “Install”.',
    'Не става ли? Копирай линка и го постави в Chrome:': 'Not working? Copy the link and paste it into Chrome:',
    'Копирай': 'Copy',
    'Копирано ✓': 'Copied ✓',
    'Линк': 'Link',
    'Инсталирай през Chrome': 'Install through Chrome',
    'Браузърът на Samsung прави приложението по стар начин и телефонът го спира с „Блокирано е небезопасно приложение“. През': 'The Samsung browser builds the app the old way and the phone stops it with “Unsafe app blocked”. Through',
    'се инсталира нормално.': 'it installs normally.',
    'В Chrome натисни „Инсталирай“.': 'In Chrome, tap “Install”.',
    'Ако вече ти е излязло „Блокирано е небезопасно приложение“ – натисни „ОК“ и отвори линка в Chrome.': 'If you already got “Unsafe app blocked”, tap “OK” and open the link in Chrome.',
    'Добави на началния екран': 'Add to the home screen',
    'Натисни': 'Tap',
    '„Сподели“': '“Share”',
    'в лентата на Safari.': 'in the Safari toolbar.',
    'Превърти надолу и избери': 'Scroll down and choose',
    '„Добави към началния екран“': '“Add to Home Screen”',
    '„Добави“': '“Add”',
    'горе вдясно.': 'in the top right.',
    'Отвори в Safari': 'Open in Safari',
    'На iPhone приложението се добавя само от': 'On iPhone the app can only be added from',
    '. Копирай линка, отвори Safari и го постави в адреса.': '. Copy the link, open Safari and paste it into the address bar.',
    'Или потърси в менюто': 'Or look in the menu',
    'ред „Отвори в Safari“.': 'for “Open in Safari”.',
    'Готово!': 'Done!',
    '„Обход“ е на началния екран. Отваряй го оттам.': '“Obhod” is on your home screen. Open it from there.',
    'Отвори приложението': 'Open the app',
    'Вече е инсталирано': 'Already installed',
    '„Обход“ е на този телефон – отвори го от началния екран.': '“Obhod” is on this phone – open it from the home screen.',
    'Без инсталиране:': 'Without installing:',
    'отвори в браузъра': 'open in the browser',
    // етикети на обектите (от таблицата)
    'Звъни се': 'Call ahead',
    'Препълнено': 'Overfull',
    'Само жълто': 'Yellow only',
    'Заявка': 'Request',
    'Ако има достъп': 'If accessible',
    '2 цвята – задължително': '2 colours – required',
    'След 5:40': 'After 5:40',
    'Син и жълт': 'Blue and yellow',
    // дни
    'Пн': 'Mon', 'Вт': 'Tue', 'Ср': 'Wed', 'Чт': 'Thu', 'Пт': 'Fri', 'Сб': 'Sat', 'Нд': 'Sun'
  };
  var DAYS = { 'понеделник': 'Monday', 'вторник': 'Tuesday', 'сряда': 'Wednesday', 'четвъртък': 'Thursday', 'петък': 'Friday', 'събота': 'Saturday', 'неделя': 'Sunday' };
  var ROUTE = { 'Банкя': 'Bankya', 'Лозенец': 'Lozenets', 'Дианабад': 'Dianabad', 'Изток': 'Iztok', 'Изгрев': 'Izgrev', 'Изгрев и Изток': 'Izgrev and Iztok', 'Красно село': 'Krasno Selo', 'Оборище': 'Oborishte', 'Търговски': 'Commercial' };
  var BIN = { 'жълта': 'yellow', 'зелена': 'green', 'синя': 'blue', 'друга': 'other' };

  // ---------- имена на места: на латиница (официалната транслитерация) ----------
  var TL = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sht', 'ъ': 'a', 'ь': 'y', 'ю': 'yu', 'я': 'ya' };
  function translit(s) {
    return String(s).replace(/ия(?=$|[^а-яА-Я])/g, 'ia').replace(/[а-яА-Я]/g, function (c) {
      var l = c.toLowerCase(), t = TL[l]; if (t == null) return c;
      return c === l ? t : t.charAt(0).toUpperCase() + t.slice(1);
    });
  }
  var GR = null;
  function groups() {
    if (GR) return GR;
    var R = window.ROUTES; if (!R || !R.length) return {};
    GR = {};
    for (var i = 0; i < R.length; i++) { var g = R[i].groups || []; for (var j = 0; j < g.length; j++) GR[g[j]] = 1; }
    return GR;
  }
  function place(s) {
    if (ROUTE.hasOwnProperty(s)) return ROUTE[s];
    var m;
    if ((m = /^Карта (\d+) – Булекосервиз$/.exec(s))) return 'Map ' + m[1] + ' – Bulekoservis';
    if ((m = /^Карта (\d+)$/.exec(s))) return 'Map ' + m[1];
    if ((m = /^Пълни зелени – (.+)$/.exec(s))) return 'Full green – ' + translit(m[1]);
    if (groups().hasOwnProperty(s)) return translit(s);
    return null;
  }
  var pl = function (s) { return place(s) || s; };
  var names = function (s) { return s.split(' и ').map(pl).join(' and '); };
  var day = function (s) { return DAYS[String(s).toLowerCase()] || null; };
  var dy = function (s) { return day(s) || s; };
  var sites = function (n) { return n + (+n === 1 ? ' site' : ' sites'); };
  var every = function (s) { return 'every ' + dy(s); };
  // „2 жълти + 1 зелен“, „1 синя“
  var CONT = /^\d+ (?:синя|сини|жълта|жълти|жълт|зелен|зелени)(?: \+ \d+ (?:синя|сини|жълта|жълти|жълт|зелен|зелени))*$/;
  function cont(s) {
    if (s === 'без кофи') return 'no bins';
    return s.replace(/(\d+) (синя|сини)/g, '$1 blue').replace(/(\d+) (жълта|жълти|жълт)/g, '$1 yellow').replace(/(\d+) (зелени|зелен)/g, '$1 green');
  }

  // ---------- шаблони за съставените текстове ----------
  var P = [
    [CONT, function (m) { return cont(m[0]); }],
    [/^(\d+) м$/, function (m) { return m[1] + ' m'; }],
    [/^(\d+(?:,\d+)?) км$/, function (m) { return m[1].replace(',', '.') + ' km'; }],
    [/^(.+) ✓$/, function (m) { var p = place(m[1]); return p ? p + ' ✓' : null; }],
    [/^Няма връзка – (\d+) (?:отметка чака|отметки чакат)$/, function (m) { return 'No connection – ' + m[1] + (+m[1] === 1 ? ' check-off' : ' check-offs') + ' waiting'; }],
    [/^Маршрут: следващите (\d+)$/, function (m) { return 'Route: next ' + m[1]; }],
    [/^Навигация до т(?:\.|очка) (.+)$/, function (m) { return 'Navigate to point ' + m[1]; }],
    [/^Навигация до (.+)$/, function (m) { return 'Navigate to ' + m[1]; }],
    [/^Навигация с (.+)\.$/, function (m) { return 'Navigating with ' + m[1] + '.'; }],
    [/^(\d+) обекта?$/, function (m) { return sites(m[1]); }],
    [/^Наряд (\S+)$/, function (m) { return day(m[1]); }],
    [/^Наряд (\S+), (.+)$/, function (m) { var d = day(m[1]); return d ? d + ' schedule, ' + m[2] : null; }],
    [/^Добави или махни обекти за (.+)$/, function (m) { return 'Add or remove sites for ' + (m[1] === 'деня' ? 'the day' : m[1]); }],
    [/^↻ запис (.+)$/, function (m) { return '↻ saved ' + m[1]; }],
    [/^Няма връзка с таблицата – нарядът е от (.+)\. Натисни, за да опиташ пак\.$/, function (m) { return 'No connection to the sheet – the schedule is from ' + m[1] + '. Tap to try again.'; }],
    [/^добавен от (.+)$/, function (m) { return 'added by ' + m[1]; }],
    [/^махнат от (.+)$/, function (m) { return 'removed by ' + m[1]; }],
    [/^Минато (.+)$/, function (m) { return 'Done ' + m[1]; }],
    [/^Няма обекти в наряда(?: за (\S+))?\.$/, function (m) { return 'No sites on the schedule' + (m[1] ? ' for ' + dy(m[1]) : '') + '.'; }],
    [/^Счупена кофа: (.+)$/, function (m) { return 'Broken bin: ' + m[1].split(', ').map(function (k) { return BIN[k] || k; }).join(', '); }],
    [/^Към (.+)$/, function (m) { return 'To ' + pl(m[1]); }],
    [/^→ (.+) (\S+)$/, function (m) { return '→ ' + pl(m[1]) + ' ' + m[2]; }],
    [/^(.+) (\S+) →$/, function (m) { return pl(m[1]) + ' ' + m[2] + ' →'; }],
    [/^Върни точка (.+)$/, function (m) { return 'Undo point ' + m[1]; }],
    [/^Минах точка (.+)$/, function (m) { return 'Mark point ' + m[1] + ' done'; }],
    [/^Остават (\d+)$/, function (m) { return 'Left ' + m[1]; }],
    [/^Всички (\d+)$/, function (m) { return 'All ' + m[1]; }],
    [/^Минати (\d+)$/, function (m) { return 'Done ' + m[1]; }],
    [/^Редът за (\S+) е сменен(?: от (.+))?$/, function (m) { return 'Order for ' + m[1] + ' changed' + (m[2] ? ' by ' + m[2] : ''); }],
    [/^За (?:всеки|всяка) (\S+)$/, function (m) { return 'For ' + every(m[1]); }],
    [/^Редът е запазен за (?:всеки|всяка) (\S+)\.$/, function (m) { return 'Order saved for ' + every(m[1]) + '.'; }],
    [/^Редът за (\S+) е върнат по наряда\.$/, function (m) { return 'Order for ' + m[1] + ' reset to the schedule.'; }],
    [/^(.+) е № (\S+) за (\S+)\.$/, function (m) { return m[1] + ' is No. ' + m[2] + ' for ' + m[3] + '.'; }],
    [/^(.+) за (\d\d\.\d\d)\.$/, function (m) { return m[1] + ' for ' + m[2] + '.'; }],
    [/^Линията на картата е приблизителният маршрут по (.+?)\.(?: (.+) се карат заедно – когато следващата точка е в другия наряд, приложението те прехвърля там\.)? Линията се скрива с бутона вдясно на картата\.$/, function (m) {
      return 'The line on the map is the approximate route from ' + m[1].replace(/^GPS запис/, 'a GPS recording of') + '.' +
        (m[2] ? ' ' + names(m[2]) + ' are driven together – when the next point is on the other route, the app switches you there.' : '') +
        ' Hide the line with the button on the right of the map.';
    }],
    [/^(.+) се карат заедно – когато следващата точка е в другия наряд, те прехвърлям там\.$/, function (m) { return names(m[1]) + ' are driven together – when the next point is on the other route, I switch you there.'; }],
    [/^Следващата точка е в (.+) – т\. (\S+)\. Прехвърлих те там\.$/, function (m) { return 'The next point is in ' + pl(m[1]) + ' – point ' + m[2] + '. Switched you there.'; }],
    [/^(.+): новият курс започна\.$/, function (m) { return names(m[1]) + ': new round started.'; }],
    [/^(.+) се карат заедно\. Да изчистя ли отметките и на (двата|всички) наряда \((\d+)\)\? Изчиства се за всички шофьори\.$/, function (m) {
      return names(m[1]) + ' are driven together. Clear the check-offs on ' + (m[2] === 'двата' ? 'both' : 'all') + ' routes (' + m[3] + ')? This clears them for all drivers.';
    }],
    [/^Да изчистя ли всички (\d+) (?:отметка|отметки) за (.+)\? Изчиства се за всички шофьори\.$/, function (m) {
      return (+m[1] === 1 ? 'Clear the 1 check-off for ' + pl(m[2]) + '? This clears it' : 'Clear all ' + m[1] + ' check-offs for ' + pl(m[2]) + '? This clears them') + ' for all drivers.';
    }],
    [/^Само (.+)$/, function (m) { return 'Only ' + pl(m[1]); }],
    [/^Здравей, (.+)!$/, function (m) { return 'Hi, ' + m[1] + '!'; }],
    [/^т\. (\S+)(?: – (.+))?$/, function (m) { return 'point ' + m[1] + (m[2] ? ' – ' + m[2] : ''); }],
    [/^(\d+) обекта?\. Промените са само за тази дата и ги виждат всички шофьори\.$/, function (m) { return sites(m[1]) + '. Changes apply to this date only and all drivers see them.'; }],
    [/^Променя: (.+)$/, function (m) { return 'Editing: ' + m[1]; }],
    [/^Добави за (.+)$/, function (m) { return 'Add for ' + m[1]; }],
    [/^По заявка за (\S+)$/, function (m) { return 'On request for ' + dy(m[1]); }],
    [/^Нов обект: „(.+)“$/, function (m) { return 'New site: “' + m[1] + '”'; }],
    [/^добавя се за (.+) и в списъка с обекти \(по заявка\)$/, function (m) { return 'added for ' + m[1] + ' and to the site list (on request)'; }],
    [/^Влязохте като (.+) – може да променяте наряда\.$/, function (m) { return 'Signed in as ' + m[1] + ' – you can edit the schedule.'; }],
    [/^(.+): (\d+ (?:синя|сини|жълта|жълти)(?: \+ \d+ (?:жълта|жълти))?|без кофи)\.$/, function (m) { return m[1] + ': ' + cont(m[2]) + '.'; }],
    [/^Приложението е обновено – версия (\d+)\.$/, function (m) { return 'The app is up to date – version ' + m[1] + '.'; }],
    [/^Не се зареди: (.+)$/, function (m) { return 'Did not load: ' + m[1]; }],
    [/^Грешка: (.+)$/, function (m) { return 'Error: ' + m[1]; }]
  ];

  var CYR = /[А-Яа-яЁё]/;
  function tr0(s) {
    if (D.hasOwnProperty(s)) return D[s];
    var r = place(s); if (r) return r;
    r = day(s); if (r) return r;
    var parts, ch, i;
    if (s.indexOf('\n') >= 0) parts = s.split('\n'), i = '\n';
    else if (s.indexOf(' · ') > 0) parts = s.split(' · '), i = ' · ';
    if (parts) {
      ch = false;
      parts = parts.map(function (x) { if (!CYR.test(x)) return x; var t = tr0(x.trim()); if (t == null) return x; ch = true; return x.replace(x.trim(), t); });
      return ch ? parts.join(i) : null;
    }
    for (i = 0; i < P.length; i++) {
      var m = P[i][0].exec(s);
      if (m) { r = P[i][1](m); if (r != null) return r; }
    }
    return null;
  }
  var cache = {}, csize = 0;
  function tr(s) {
    if (!s || !CYR.test(s)) return null;
    if (cache.hasOwnProperty(s)) return cache[s];
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), r = null;
    try { r = tr0(m[2]); } catch (e) {}
    if (r != null) r = m[1] + r + m[3];
    if (++csize > 5000) { cache = {}; csize = 0; }
    cache[s] = r;
    return r;
  }
  I.tr = function (s) { var r = tr(s); return r == null ? s : r; };

  // ---------- подмяна на екрана ----------
  // данни, които не се превеждат: имена на обекти/улици, бележки, имената на шофьорите
  var SKIP = '.st, #card .note, #binsWhere, #names, [data-lang], script, style';
  var ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
  function doText(n) {
    var p = n.parentNode;
    if (!p || p.nodeType !== 1 || p.matches(SKIP)) return;
    var v = n.nodeValue, r = tr(v);
    if (r != null && r !== v) n.nodeValue = r;
  }
  function doAttr(e, a) {
    var v = e.getAttribute(a);
    if (!v || !CYR.test(v)) return;
    var r = tr(v);
    if (r != null && r !== v) e.setAttribute(a, r);
  }
  function doEl(e) { for (var i = 0; i < ATTRS.length; i++) doAttr(e, ATTRS[i]); }
  var FILTER = { acceptNode: function (n) { return n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } };
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    doEl(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTER), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
  }
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.type === 'childList') { for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]); }
      else if (r.type === 'characterData') doText(r.target);
      else if (r.target.nodeType === 1 && !r.target.closest(SKIP)) doAttr(r.target, r.attributeName);
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  walk(document.documentElement);
  document.addEventListener('DOMContentLoaded', function () { walk(document.documentElement); });
})();
