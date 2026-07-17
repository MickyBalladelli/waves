import { CONFIG } from './config';

function bind(
  id: string,
  valId: string,
  key: keyof typeof CONFIG,
  digits: number,
) {
  const input = document.getElementById(id) as HTMLInputElement;
  const label = document.getElementById(valId) as HTMLSpanElement;
  const apply = () => {
    CONFIG[key] = +input.value;
    label.textContent = CONFIG[key].toFixed(digits);
  };
  input.addEventListener('input', apply);
  apply();
}

export function setupUI() {
  bind('sea', 'vSea', 'seaState', 2);
  bind('wind', 'vWind', 'windSpeed', 2);
  bind('chop', 'vChop', 'choppiness', 2);
  bind('break', 'vBreak', 'breakDistance', 1);

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    (document.getElementById('sea') as HTMLInputElement).value = '1';
    (document.getElementById('wind') as HTMLInputElement).value = '1';
    (document.getElementById('chop') as HTMLInputElement).value = '1';
    (document.getElementById('break') as HTMLInputElement).value = '9';
    CONFIG.seaState = 1;
    CONFIG.windSpeed = 1;
    CONFIG.choppiness = 1;
    CONFIG.breakDistance = 9;
    (document.getElementById('vSea') as HTMLSpanElement).textContent = '1.00';
    (document.getElementById('vWind') as HTMLSpanElement).textContent = '1.00';
    (document.getElementById('vChop') as HTMLSpanElement).textContent = '1.00';
    (document.getElementById('vBreak') as HTMLSpanElement).textContent = '9.0';
  });
}
