/**
 * voice.js — Voice recognition + waveform visualizer
 *
 * Uses the Web Speech API (SpeechRecognition) for live transcription.
 * Falls back to a simulated transcript if the API is not supported.
 * Google Cloud Speech-to-Text endpoint is referenced for server-side
 * processing — swap processWithGoogleAPI() with a real fetch() call
 * when a backend proxy is available.
 *
 * GOOGLE CLOUD STT reference:
 * https://speech.googleapis.com/$discovery/rest?version=v2
 */

const VoiceService = (() => {
  // ── Emergency type keywords ──────────────────────
  const EMERGENCY_MAP = [
    { keywords: ['fire','blaze','smoke','burning','flames'],              type: 'Fire',    agency: 'Fire Brigade (101)' },
    { keywords: ['medical','ambulance','heart','breathing','injured','pain','bleeding','unconscious','overdose'], type: 'Medical', agency: 'Ambulance (108)' },
    { keywords: ['crime','robbery','theft','assault','attack','violence','shooting','stabbing','murder'],        type: 'Crime',   agency: 'Police (100)' },
    { keywords: ['flood','earthquake','storm','natural','disaster','collapse'],                                 type: 'Natural', agency: 'Disaster Response' },
    { keywords: ['help','emergency','sos','danger','trap','hostage'],                                           type: 'Unknown', agency: 'Emergency Services (112)' },
  ];
  
  // ── State ─────────────────────────────────────────
  let _recognition   = null;
  let _audioCtx      = null;
  let _analyser      = null;
  let _mediaStream   = null;
  let _animFrameId   = null;
  let _finalTranscript = '';
  let _detectedType  = null;
  let _onResult      = null;  // callback(type, agency, transcript)

  // ── Elements ──────────────────────────────────────
  const el = {
    transcriptText: () => document.getElementById('transcriptText'),
    detectedType:   () => document.getElementById('detectedType'),
    dtValue:        () => document.getElementById('dtValue'),
    dtAgency:       () => document.getElementById('dtAgency'),
    canvas:         () => document.getElementById('waveCanvas'),
  };

  // ── Public: start ────────────────────────────────
  async function start(onResultCallback) {
    _onResult = onResultCallback;
    _finalTranscript = '';
    _detectedType = null;
    _resetUI();
    await _startWaveform();
    _startRecognition();
  }

  // ── Public: stop ─────────────────────────────────
  function stop() {
    if (_recognition) { try { _recognition.stop(); } catch(e){} _recognition = null; }
    _stopWaveform();
  }

  // ── WAVEFORM ─────────────────────────────────────
  async function _startWaveform() {
    try {
      _mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
      _analyser  = _audioCtx.createAnalyser();
      _analyser.fftSize = 256;
      const src  = _audioCtx.createMediaStreamSource(_mediaStream);
      src.connect(_analyser);
      _drawWave();
    } catch(e) {
      // Mic denied or not available — draw idle animation
      _drawIdleWave();
    }
  }

  function _stopWaveform() {
    if (_animFrameId) { cancelAnimationFrame(_animFrameId); _animFrameId = null; }
    if (_audioCtx)    { try { _audioCtx.close(); } catch(e){} _audioCtx = null; }
    if (_mediaStream) { _mediaStream.getTracks().forEach(t => t.stop()); _mediaStream = null; }
  }

  function _drawWave() {
    const canvas = el.canvas();
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const buf = new Uint8Array(_analyser.frequencyBinCount);

    function frame() {
      _animFrameId = requestAnimationFrame(frame);
      _analyser.getByteTimeDomainData(buf);

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#181818';
      ctx.fillRect(0, 0, W, H);

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#C8102E';
      ctx.shadowColor = '#C8102E';
      ctx.shadowBlur  = 8;
      ctx.beginPath();

      const step = W / buf.length;
      let x = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] / 128.0;
        const y = (v * H) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += step;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    frame();
  }

  function _drawIdleWave() {
    const canvas = el.canvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    let t = 0;

    function frame() {
      _animFrameId = requestAnimationFrame(frame);
      t += 0.06;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#181818';
      ctx.fillRect(0, 0, W, H);

      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(200,16,46,.5)';
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const y = H / 2 + Math.sin((x / W) * Math.PI * 4 + t) * 12 * Math.sin(t * 0.5);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    frame();
  }

  // ── SPEECH RECOGNITION ───────────────────────────
  function _startRecognition() {
    const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechAPI) {
      // Fallback: simulate after 2.5s
      console.warn('SpeechRecognition not supported — using simulation.');
      _simulateTranscript();
      return;
    }

    _recognition = new SpeechAPI();
    _recognition.continuous     = true;
    _recognition.interimResults = true;
    _recognition.lang           = 'en-IN';
    _recognition.maxAlternatives = 1;

    _recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) _finalTranscript += t + ' ';
        else interim = t;
      }
      const display = (_finalTranscript + interim).trim();
      _updateTranscript(display);
      _tryDetectType(display);
    };

    _recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        _updateTranscript('Microphone permission denied. Type the problem below and tap Skip.');
        return;
      }
      if (e.error === 'no-speech') {
        _updateTranscript('No voice detected. Speak again or type the problem below, then tap Skip.');
        return;
      }
      if (e.error === 'audio-capture') {
        _updateTranscript('Microphone was not found. Type the problem below and tap Skip.');
      }
    };

    _recognition.onend = () => {
      // Auto-stop waveform and call back
      _stopWaveform();
      if (_onResult && _finalTranscript) {
        const { type, agency } = _detectType(_finalTranscript) || { type: 'Unknown', agency: 'Emergency Services (112)' };
        _onResult(type, agency, _finalTranscript.trim());
        return;
      }
      _updateTranscript('No voice captured. Type the problem below and tap Skip to continue.');
    };

    _recognition.start();

    // Auto-stop after 12s
    setTimeout(() => { if (_recognition) _recognition.stop(); }, 12000);
  }

  // ── Google Cloud STT (server-side stub) ───────────
  // Replace this function body with a fetch() to your backend proxy.
  // Your backend should POST audio to:
  // https://speech.googleapis.com/v2/projects/{project}/locations/global/recognizers/-:recognize
  // and return { transcript, confidence }
  async function processWithGoogleAPI(audioBlob) {
    /*
    const resp = await fetch('/api/speech-to-text', {
      method: 'POST',
      body: audioBlob,
      headers: { 'Content-Type': 'audio/webm' }
    });
    const data = await resp.json();
    return data.transcript || '';
    */
    return ''; // stub
  }

  // ── Type detection ────────────────────────────────
  function _detectType(text) {
    const lower = text.toLowerCase();
    for (const entry of EMERGENCY_MAP) {
      if (entry.keywords.some(k => lower.includes(k))) {
        return { type: entry.type, agency: entry.agency };
      }
    }
    return { type: 'Unknown', agency: 'Emergency Services (112)' };
  }

  function _tryDetectType(text) {
    const result = _detectType(text);
    if (result.type !== 'Unknown' || text.length > 12) {
      _detectedType = result;
      _showDetected(result.type, result.agency);
      if (_onResult) {
        // Fire early callback with detected type
        // Full callback still fires on recognition end
      }
    }
  }

  // ── UI helpers ────────────────────────────────────
  function _resetUI() {
    const tt = el.transcriptText();
    const dt = el.detectedType();
    if (tt) { tt.textContent = 'Listening…'; tt.className = 'transcript-text'; }
    if (dt) dt.hidden = true;
  }

  function _updateTranscript(text) {
    const tt = el.transcriptText();
    if (tt) { tt.textContent = text || 'Listening…'; tt.className = 'transcript-text' + (text ? ' heard' : ''); }
  }

  function _showDetected(type, agency) {
    const dtEl = el.detectedType();
    const dtV  = el.dtValue();
    const dtA  = el.dtAgency();
    if (dtEl) dtEl.hidden = false;
    if (dtV)  dtV.textContent  = type;
    if (dtA)  dtA.textContent  = 'Dispatching → ' + agency;
  }

  // ── Simulation fallback ───────────────────────────
  function _simulateTranscript() {
    const phrases = [
      'Help! There is a fire in the building!',
      'Medical emergency, someone collapsed!',
      'Crime in progress, robbery at the store!',
      'Emergency, please send help immediately!',
    ];
    const chosen = phrases[Math.floor(Math.random() * phrases.length)];
    let idx = 0;
    const interval = setInterval(() => {
      idx++;
      const partial = chosen.slice(0, idx * 3);
      _updateTranscript(partial);
      _tryDetectType(partial);
      if (idx * 3 >= chosen.length) {
        clearInterval(interval);
        _finalTranscript = chosen;
        _stopWaveform();
        setTimeout(() => {
          const { type, agency } = _detectType(chosen);
          if (_onResult) _onResult(type, agency, chosen);
        }, 800);
      }
    }, 60);
  }

  // ── Public API ────────────────────────────────────
  return { start, stop, detectType: _detectType };
})();

window.VoiceService = VoiceService;
