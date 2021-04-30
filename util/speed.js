

function getSpeed(t1, t2, bytes) {
    let diff = t2 - t1;
    return formatSpeed(Math.floor(bytes/diff));
}


function formatSpeed(speed) {
    let unit = ['', 'K', 'M', 'G', 'T'];
    let index = 0;
    while (speed >= 1024) {
        speed = speed / 1024;
        ++index;
    }
    return speed + unit[index] + 'B/s';
}

module.exports = { getSpeed };