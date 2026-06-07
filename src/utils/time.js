export function format(ms) {
    const total = Math.floor(
        ms / 1000);
    const hour = Math.floor(
        total / 3600);
    const min = Math.floor(
        (total % 3600) / 60);
    const sec = total % 60;
    return { hour, min, sec };
}

export function pad(n) {
    return (String(n)
        .padStart(2, '0')
    );
}

export function uptime(ms) {
    const { hour, min, sec
        } = format(ms);
    return (`${pad(hour)}:`
        + `${pad(min)}:`
        + `${pad(sec)}`
    );
}

export function getDate() {
    return (`${getYear()}-`
        + `${getMonth()}-`
        + `${getDay()}`
    );
}

export function getYear() {
    return (new Date()
        .getFullYear()
    );
}

export function getMonth() {
    return (String(new Date()
        .getMonth() + 1)
        .padStart(2, '0')
    );
}

export function getDay() {
    return (String(new Date()
        .getDate())
        .padStart(2, '0')
    );
}

export function getTime() {
    return (new Date()
        .toTimeString()
        .split(' ')[0]
    );
}