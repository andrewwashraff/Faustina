(() => {
  'use strict';

  const data = window.SONG_DATA;
  if (!data) throw new Error('song-data.js did not load.');

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const audio = $('#audio');
  const playButton = $('#playButton');
  const seekBar = $('#seekBar');
  const currentTimeLabel = $('#currentTime');
  const durationLabel = $('#durationTime');
  const lyricsScroller = $('#lyricsScroller');
  const giftGate = $('#giftGate');
  const timingEditor = $('#timingEditor');
  const bottomSheet = $('#bottomSheet');
  const sheetBackdrop = $('#sheetBackdrop');
  const toast = $('#toast');

  const originalTimes = [];
  const flatLyrics = [];
  const lyricElements = [];
  let activeIndex = -1;
  let selectedEditorIndex = 0;
  let userScrollingUntil = 0;
  let rafId = 0;
  let toastTimer = 0;
  let isDraggingSeek = false;

  const storageKey = `lyrics-times:${data.title}`;

  function formatTime(seconds, withHundredths = false) {
    if (!Number.isFinite(seconds)) seconds = 0;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds - minutes * 60;
    return withHundredths
      ? `${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`
      : `${minutes}:${String(Math.floor(secs)).padStart(2, '0')}`;
  }

  function applyData() {
    document.title = `${data.title} — لفُوسْتِينا`;
    $('#songTitle').textContent = data.title;
    $('#songArtist').textContent = data.artist;
    $('#gateTitle').textContent = data.title;
    $('#gateOccasion').textContent = data.occasion;
    $('#footerNote').textContent = data.occasion;

    ['#coverImage', '#ambientCover', '#gateCover'].forEach((selector) => {
      const el = $(selector);
      el.src = data.cover;
    });
    audio.src = data.audio;
    durationLabel.textContent = formatTime(data.duration || 0);

    if ('mediaSession' in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: data.title,
        artist: data.artist,
        album: data.occasion,
        artwork: [{ src: data.cover, sizes: '360x360', type: 'image/jpeg' }],
      });
      navigator.mediaSession.setActionHandler('play', () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime;
      });
    }
  }

  function flattenAndRenderLyrics() {
    lyricsScroller.replaceChildren();
    flatLyrics.length = 0;
    lyricElements.length = 0;
    originalTimes.length = 0;

    for (const section of data.sections) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'lyricSection';
      sectionEl.textContent = section.name;
      lyricsScroller.append(sectionEl);

      for (const line of section.lines) {
        const index = flatLyrics.length;
        const normalized = {
          text: line.text,
          time: Number(line.time),
          section: section.name,
        };
        flatLyrics.push(normalized);
        originalTimes.push(normalized.time);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lyricLine';
        button.dataset.index = String(index);
        button.dataset.time = String(normalized.time);
        button.setAttribute('aria-label', `${normalized.text} — ${formatTime(normalized.time)}`);

        const text = document.createElement('span');
        text.className = 'lyricText';
        text.textContent = normalized.text;
        const badge = document.createElement('span');
        badge.className = 'lyricTimeBadge';
        badge.textContent = formatTime(normalized.time, true);
        button.append(text, badge);

        button.addEventListener('click', () => {
          const i = Number(button.dataset.index);
          selectEditorLine(i, false);
          audio.currentTime = flatLyrics[i].time;
          audio.play().catch(() => {});
        });

        lyricsScroller.append(button);
        lyricElements.push(button);
      }
    }

    restoreTimings();
  }

  function restoreTimings() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(stored) && stored.length === flatLyrics.length && stored.every(Number.isFinite)) {
        stored.forEach((time, i) => setLyricTime(i, time, false));
      }
    } catch (_) {}
  }

  function refreshLyricTimeUi(index) {
    lyricElements[index].dataset.time = String(flatLyrics[index].time);
    $('.lyricTimeBadge', lyricElements[index]).textContent = formatTime(flatLyrics[index].time, true);
    lyricElements[index].setAttribute('aria-label', `${flatLyrics[index].text} — ${formatTime(flatLyrics[index].time)}`);
  }

  function setLyricTime(index, seconds, persist = true) {
    if (!flatLyrics[index]) return;
    const previous = index > 0 ? flatLyrics[index - 1].time + 0.05 : 0;
    const duration = audio.duration || data.duration || Infinity;
    flatLyrics[index].time = Math.round(Math.min(Math.max(Number(seconds) || 0, previous), duration) * 100) / 100;
    refreshLyricTimeUi(index);

    // Keep following lines in order. This lets the tap-to-sync workflow move a
    // line later than its original seed without getting trapped by the next line.
    for (let i = index + 1; i < flatLyrics.length; i += 1) {
      const minimum = Math.round((flatLyrics[i - 1].time + 0.05) * 100) / 100;
      if (flatLyrics[i].time >= minimum) break;
      flatLyrics[i].time = minimum;
      refreshLyricTimeUi(i);
    }

    if (persist) saveTimings();
    updateEditorCard();
  }

  function saveTimings() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(flatLyrics.map((line) => line.time)));
    } catch (_) {}
  }

  function findActiveLine(time) {
    let low = 0;
    let high = flatLyrics.length - 1;
    let answer = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (flatLyrics[middle].time <= time + 0.08) {
        answer = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return answer;
  }

  function updateActiveLine(forceScroll = false) {
    const next = findActiveLine(audio.currentTime);
    if (next === activeIndex && !forceScroll) return;
    activeIndex = next;

    lyricElements.forEach((el, index) => {
      el.classList.toggle('isPast', index < activeIndex);
      el.classList.toggle('isActive', index === activeIndex);
      if (index === activeIndex) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
    });

    if (activeIndex >= 0 && (forceScroll || Date.now() > userScrollingUntil)) {
      lyricElements[activeIndex].scrollIntoView({ behavior: forceScroll ? 'auto' : 'smooth', block: 'center' });
    }
    if (!timingEditor.classList.contains('isOpen')) selectedEditorIndex = Math.max(activeIndex, 0);
  }

  function updateProgress() {
    const duration = audio.duration || data.duration || 1;
    if (!isDraggingSeek) {
      const progress = Math.min(100, (audio.currentTime / duration) * 100);
      seekBar.value = String(progress);
      seekBar.style.setProperty('--progress', `${progress}%`);
    }
    currentTimeLabel.textContent = formatTime(audio.currentTime);
    updateActiveLine();

    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && Number.isFinite(audio.duration) && audio.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime, audio.duration),
        });
      } catch (_) {}
    }
  }

  function animationLoop() {
    updateProgress();
    if (!audio.paused) rafId = requestAnimationFrame(animationLoop);
  }

  function setPlayingState(isPlaying) {
    document.body.classList.toggle('isPlaying', isPlaying);
    playButton.setAttribute('aria-label', isPlaying ? 'إيقاف مؤقت' : 'تشغيل');
    playButton.title = isPlaying ? 'إيقاف مؤقت' : 'تشغيل';
    cancelAnimationFrame(rafId);
    if (isPlaying) rafId = requestAnimationFrame(animationLoop);
  }

  function togglePlayback() {
    if (audio.paused) audio.play().catch(() => showToast('دوسي تشغيل مرة تانية عشان يبدأ الصوت'));
    else audio.pause();
  }

  function seekBy(seconds) {
    const duration = audio.duration || data.duration || Infinity;
    audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + seconds));
    updateProgress();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
  }

  async function sharePage() {
    const shareData = {
      title: data.title,
      text: `${data.title} — ${data.occasion}`,
      url: location.href.split('?')[0],
    };
    try {
      if (navigator.share && location.protocol !== 'file:') {
        await navigator.share(shareData);
      } else if (navigator.clipboard && location.protocol !== 'file:') {
        await navigator.clipboard.writeText(shareData.url);
        showToast('اللينك اتنسخ ♡');
      } else {
        showToast('بعد الرفع على الإنترنت هتقدري تنسخي اللينك من هنا');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('ماقدرتش أفتح المشاركة دلوقتي');
    }
  }

  function openSheet() {
    sheetBackdrop.hidden = false;
    requestAnimationFrame(() => bottomSheet.classList.add('isOpen'));
    bottomSheet.setAttribute('aria-hidden', 'false');
  }

  function closeSheet() {
    bottomSheet.classList.remove('isOpen');
    bottomSheet.setAttribute('aria-hidden', 'true');
    if (!timingEditor.classList.contains('isOpen')) {
      setTimeout(() => { sheetBackdrop.hidden = true; }, 350);
    }
  }

  function openEditor() {
    closeSheet();
    document.body.classList.add('editMode');
    timingEditor.classList.add('isOpen');
    timingEditor.setAttribute('aria-hidden', 'false');
    sheetBackdrop.hidden = false;
    selectEditorLine(Math.max(activeIndex, 0), true);
  }

  function closeEditor() {
    document.body.classList.remove('editMode');
    timingEditor.classList.remove('isOpen');
    timingEditor.setAttribute('aria-hidden', 'true');
    setTimeout(() => { sheetBackdrop.hidden = true; }, 350);
    lyricElements.forEach((el) => el.classList.remove('isEditorSelected'));
  }

  function selectEditorLine(index, scroll = true) {
    selectedEditorIndex = Math.max(0, Math.min(flatLyrics.length - 1, index));
    lyricElements.forEach((el, i) => el.classList.toggle('isEditorSelected', i === selectedEditorIndex));
    updateEditorCard();
    if (scroll && lyricElements[selectedEditorIndex]) {
      lyricElements[selectedEditorIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function updateEditorCard() {
    const line = flatLyrics[selectedEditorIndex];
    if (!line) return;
    $('#selectedLineNumber').textContent = `السطر ${selectedEditorIndex + 1} من ${flatLyrics.length}`;
    $('#selectedLyricText').textContent = line.text;
    $('#selectedLyricTime').textContent = formatTime(line.time, true);
  }

  function markAndAdvance() {
    const current = audio.currentTime;
    setLyricTime(selectedEditorIndex, current, true);
    showToast(`اتثبت عند ${formatTime(flatLyrics[selectedEditorIndex].time, true)}`);
    if (selectedEditorIndex < flatLyrics.length - 1) selectEditorLine(selectedEditorIndex + 1, true);
  }

  function exportSongData() {
    const clone = JSON.parse(JSON.stringify(data));
    let cursor = 0;
    for (const section of clone.sections) {
      for (const line of section.lines) {
        line.time = flatLyrics[cursor++].time;
      }
      section.start = section.lines[0]?.time ?? section.start;
    }
    const content = `// Replace assets/cover.jpg with your final picture using the same filename.\nwindow.SONG_DATA = ${JSON.stringify(clone, null, 2)};\n`;
    const blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'song-data.js';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('الملف اتحمّل — استبدله بالقديم');
  }

  function resetTimings() {
    if (!confirm('ترجّع كل التوقيتات للنسخة الأصلية؟')) return;
    originalTimes.forEach((time, index) => setLyricTime(index, time, false));
    localStorage.removeItem(storageKey);
    updateActiveLine(true);
    updateEditorCard();
    showToast('رجّعنا التوقيت الأصلي');
  }

  function openGift({ play = true } = {}) {
    document.body.classList.add('giftOpened');
    giftGate.classList.add('isHidden');
    try { sessionStorage.setItem('gift-opened', '1'); } catch (_) {}
    if (play) audio.play().catch(() => {});
    setTimeout(() => updateActiveLine(true), 550);
  }

  function replayGift() {
    closeSheet();
    audio.pause();
    audio.currentTime = 0;
    document.body.classList.remove('giftOpened');
    giftGate.classList.remove('isHidden');
    try { sessionStorage.removeItem('gift-opened'); } catch (_) {}
  }

  function bindEvents() {
    $('#openGiftButton').addEventListener('click', () => openGift({ play: true }));
    playButton.addEventListener('click', togglePlayback);
    $('#rewindButton').addEventListener('click', () => seekBy(-10));
    $('#forwardButton').addEventListener('click', () => seekBy(10));

    audio.addEventListener('play', () => setPlayingState(true));
    audio.addEventListener('pause', () => setPlayingState(false));
    audio.addEventListener('ended', () => setPlayingState(false));
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', () => {
      durationLabel.textContent = formatTime(audio.duration);
      updateProgress();
    });

    seekBar.addEventListener('pointerdown', () => { isDraggingSeek = true; });
    seekBar.addEventListener('input', () => {
      const duration = audio.duration || data.duration || 0;
      const progress = Number(seekBar.value);
      seekBar.style.setProperty('--progress', `${progress}%`);
      currentTimeLabel.textContent = formatTime((progress / 100) * duration);
    });
    const commitSeek = () => {
      const duration = audio.duration || data.duration || 0;
      audio.currentTime = (Number(seekBar.value) / 100) * duration;
      isDraggingSeek = false;
      updateProgress();
    };
    seekBar.addEventListener('change', commitSeek);
    seekBar.addEventListener('pointerup', commitSeek);

    lyricsScroller.addEventListener('wheel', () => { userScrollingUntil = Date.now() + 4500; }, { passive: true });
    lyricsScroller.addEventListener('touchstart', () => { userScrollingUntil = Date.now() + 4500; }, { passive: true });

    $('#shareButton').addEventListener('click', sharePage);
    $('#copyLinkButton').addEventListener('click', () => { closeSheet(); sharePage(); });
    $('#menuButton').addEventListener('click', openSheet);
    sheetBackdrop.addEventListener('click', () => {
      if (timingEditor.classList.contains('isOpen')) closeEditor();
      else closeSheet();
    });
    $('#editTimingsButton').addEventListener('click', openEditor);
    $('#replayGiftButton').addEventListener('click', replayGift);
    $('#closeEditorButton').addEventListener('click', closeEditor);
    $('#markNextButton').addEventListener('click', markAndAdvance);
    $('#editorPrevButton').addEventListener('click', () => selectEditorLine(selectedEditorIndex - 1, true));
    $('#editorNextButton').addEventListener('click', () => selectEditorLine(selectedEditorIndex + 1, true));
    $$('.nudgeRow button').forEach((button) => {
      button.addEventListener('click', () => setLyricTime(selectedEditorIndex, flatLyrics[selectedEditorIndex].time + Number(button.dataset.nudge), true));
    });
    $('#exportTimingsButton').addEventListener('click', exportSongData);
    $('#resetTimingsButton').addEventListener('click', resetTimings);

    $('#heartButton').addEventListener('click', (event) => {
      event.currentTarget.classList.toggle('isLoved');
      showToast(event.currentTarget.classList.contains('isLoved') ? 'اتحفظت في القلب ♡' : 'شيلناها من القلب');
    });

    $('#mobileLyricsButton').addEventListener('click', () => $('#lyricsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }));

    document.addEventListener('keydown', (event) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.code === 'ArrowLeft') {
        seekBy(-5);
      } else if (event.code === 'ArrowRight') {
        seekBy(5);
      } else if (event.key.toLowerCase() === 'e') {
        openEditor();
      } else if (event.key === 'Escape') {
        if (timingEditor.classList.contains('isOpen')) closeEditor();
        else closeSheet();
      }
    });
  }

  applyData();
  flattenAndRenderLyrics();
  bindEvents();
  updateEditorCard();
  updateProgress();

  const params = new URLSearchParams(location.search);
  let openedBefore = false;
  try { openedBefore = sessionStorage.getItem('gift-opened') === '1'; } catch (_) {}
  if (openedBefore || params.has('preview') || params.has('edit')) openGift({ play: false });
  if (params.has('edit')) setTimeout(openEditor, 400);
})();
