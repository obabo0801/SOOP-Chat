export function format(ms) {
  const total = Math.floor(ms / 1000);
  const hour = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const sec = total % 60;

  const result = { hour, min, sec };

  return result;
}

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function uptime(ms) {
  const { hour, min, sec } = format(ms);

  const result = `${pad(hour)}:` + `${pad(min)}:` + `${pad(sec)}`;

  return result;
}

export function getDate() {
  const date = new Date();

  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

export function getYear() {
  return new Date().getFullYear();
}

export function getMonth() {
  return String(new Date().getMonth() + 1).padStart(2, '0');
}

export function getDay() {
  return String(new Date().getDate()).padStart(2, '0');
}

export function getTime() {
  const result = new Date().toTimeString().split(' ')[0];

  return result;
}
