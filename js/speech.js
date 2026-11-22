// Read it to me: the hero (and the rundown note) read aloud with the browser's speech synthesis.

/** What gets read: headline, narrative, chips ("umbrella: no, 0% all day."), then the rundown note. Pure. */
export function readAloudText({ lead = '', accent = '', narrative = '', chips = [], note = '' } = {}) {
  const clean = (s) => String(s || '').replace(/\*/g, '').replace(/°/g, ' degrees').replace(/\s*·\s*/g, ', ').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
  const end = (s) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);
  const parts = [
    end(clean(`${lead} ${accent}`).replace(/,$/, '')),
    clean(narrative),
    ...chips.filter((c) => c && c.text).map((c) => end(clean(`${c.label}: ${c.text}`))),
    end(clean(note)),
  ];
  return parts.filter(Boolean).join(' ');
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

let speaking = false;
/** Starts reading, or stops if it's already reading. Returns true when it started. */
export function toggleSpeech(text, { onChange = () => {} } = {}) {
  if (!canSpeak()) return false;
  const synth = window.speechSynthesis;
  if (speaking || synth.speaking) {
    synth.cancel();
    speaking = false;
    onChange(false);
    return false;
  }
  const u = new window.SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 1;
  const voice = (synth.getVoices ? synth.getVoices() : []).find((v) => v.lang === 'en-US');
  if (voice) u.voice = voice;
  u.onend = () => { speaking = false; onChange(false); };
  u.onerror = () => { speaking = false; onChange(false); };
  speaking = true;
  synth.speak(u);
  onChange(true);
  return true;
}
export const isSpeaking = () => speaking;
