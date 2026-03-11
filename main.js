const fs = require("fs");

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function timeToSeconds(timeStr) {
    timeStr = timeStr.trim().toLowerCase();
    const isPM = timeStr.includes("pm");
    const isAM = timeStr.includes("am");
    const clean = timeStr.replace("am", "").replace("pm", "").trim();
    const parts = clean.split(":").map(Number);
    let hours = parts[0];
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;
    if (isPM && hours !== 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
    return hours * 3600 + minutes * 60 + seconds;
}

function durationToSeconds(durStr) {
    const parts = durStr.trim().split(":").map(Number);
    return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
}

function secondsToHMS(totalSeconds) {
    if (totalSeconds < 0) totalSeconds = 0;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
}

function isEidPeriod(dateStr) {
    const [year, month, day] = dateStr.split("-").map(Number);
    return year === 2025 && month === 4 && day >= 10 && day <= 30;
}

function getDayOfWeek(dateStr) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const d = new Date(dateStr + "T00:00:00");
    return days[d.getDay()];
}

function parseShiftsFile(filePath) {
    const content = fs.readFileSync(filePath, { encoding: "utf8" });
    const lines = content.split("\n").filter(l => l.trim() !== "");
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        if (parts.length < 10) continue;
        records.push({
            driverID:      parts[0].trim(),
            driverName:    parts[1].trim(),
            date:          parts[2].trim(),
            startTime:     parts[3].trim(),
            endTime:       parts[4].trim(),
            shiftDuration: parts[5].trim(),
            idleTime:      parts[6].trim(),
            activeTime:    parts[7].trim(),
            metQuota:      parts[8].trim(),
            hasBonus:      parts[9].trim()
        });
    }
    return records;
}

function writeShiftsFile(filePath, records) {
    const header = "DriverID,DriverName,Date,StartTime,EndTime,ShiftDuration,IdleTime,ActiveTime,MetQuota,HasBonus";
    const lines = records.map(r =>
        `${r.driverID},${r.driverName},${r.date},${r.startTime},${r.endTime},${r.shiftDuration},${r.idleTime},${r.activeTime},${r.metQuota},${r.hasBonus}`
    );
    fs.writeFileSync(filePath, [header, ...lines].join("\n"), { encoding: "utf8" });
}

function parseRatesFile(filePath) {
    const content = fs.readFileSync(filePath, { encoding: "utf8" });
    const lines = content.split("\n").filter(l => l.trim() !== "");
    return lines.map(l => {
        const parts = l.split(",").map(s => s.trim());
        return {
            driverID: parts[0],
            dayOff:   parts[1],
            salary:   Number(parts[2]),
            tier:     Number(parts[3])
        };
    });
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 1
// ─────────────────────────────────────────────────────────────

function getShiftDuration(startTime, endTime) {
    const startSec = timeToSeconds(startTime);
    const endSec   = timeToSeconds(endTime);
    return secondsToHMS(endSec - startSec);
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 2
// ─────────────────────────────────────────────────────────────

function getIdleTime(startTime, endTime) {
    const startSec      = timeToSeconds(startTime);
    const endSec        = timeToSeconds(endTime);
    const deliveryStart = 8  * 3600;
    const deliveryEnd   = 22 * 3600;

    let idleBefore = 0;
    if (startSec < deliveryStart) {
        const cutoff = Math.min(endSec, deliveryStart);
        idleBefore = cutoff - startSec;
    }

    let idleAfter = 0;
    if (endSec > deliveryEnd) {
        const cutoff = Math.max(startSec, deliveryEnd);
        idleAfter = endSec - cutoff;
    }

    return secondsToHMS(idleBefore + idleAfter);
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 3
// ─────────────────────────────────────────────────────────────

function getActiveTime(shiftDuration, idleTime) {
    const shiftSec = durationToSeconds(shiftDuration);
    const idleSec  = durationToSeconds(idleTime);
    return secondsToHMS(shiftSec - idleSec);
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 4
// ─────────────────────────────────────────────────────────────

function metQuota(date, activeTime) {
    const activeSec = durationToSeconds(activeTime);
    const quota = isEidPeriod(date)
        ? 6 * 3600
        : 8 * 3600 + 24 * 60;
    return activeSec >= quota;
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 5
// ─────────────────────────────────────────────────────────────

function addShiftRecord(textFile, shiftObj) {
    const records = parseShiftsFile(textFile);

    const exists = records.some(
        r => r.driverID === shiftObj.driverID && r.date === shiftObj.date
    );
    if (exists) return {};

    const shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    const idleTime      = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    const activeTime    = getActiveTime(shiftDuration, idleTime);
    const quotaMet      = metQuota(shiftObj.date, activeTime);

    const newRecord = {
        driverID:      shiftObj.driverID,
        driverName:    shiftObj.driverName,
        date:          shiftObj.date,
        startTime:     shiftObj.startTime,
        endTime:       shiftObj.endTime,
        shiftDuration: shiftDuration,
        idleTime:      idleTime,
        activeTime:    activeTime,
        metQuota:      String(quotaMet),
        hasBonus:      "false"
    };

    records.push(newRecord);

    records.sort((a, b) => {
        if (a.driverID < b.driverID) return -1;
        if (a.driverID > b.driverID) return 1;
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return 0;
    });

    writeShiftsFile(textFile, records);

    return {
        driverID:      newRecord.driverID,
        driverName:    newRecord.driverName,
        date:          newRecord.date,
        startTime:     newRecord.startTime,
        endTime:       newRecord.endTime,
        shiftDuration: newRecord.shiftDuration,
        idleTime:      newRecord.idleTime,
        activeTime:    newRecord.activeTime,
        metQuota:      quotaMet,
        hasBonus:      false
    };
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 6
// ─────────────────────────────────────────────────────────────

function setBonus(textFile, driverID, date, newValue) {
    const records = parseShiftsFile(textFile);
    for (const r of records) {
        if (r.driverID === driverID && r.date === date) {
            r.hasBonus = String(newValue);
        }
    }
    writeShiftsFile(textFile, records);
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 7
// ─────────────────────────────────────────────────────────────

function countBonusPerMonth(textFile, driverID, month) {
    const records  = parseShiftsFile(textFile);
    const monthNum = String(parseInt(String(month), 10)).padStart(2, "0");

    const driverRecords = records.filter(r => r.driverID === driverID);
    if (driverRecords.length === 0) return -1;

    return driverRecords.filter(r => {
        const [, m] = r.date.split("-");
        return m === monthNum && r.hasBonus === "true";
    }).length;
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 8
// ─────────────────────────────────────────────────────────────

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const records  = parseShiftsFile(textFile);
    const monthNum = String(parseInt(String(month), 10)).padStart(2, "0");

    let totalSec = 0;
    for (const r of records) {
        if (r.driverID !== driverID) continue;
        const [, m] = r.date.split("-");
        if (m !== monthNum) continue;
        totalSec += durationToSeconds(r.activeTime);
    }

    return secondsToHMS(totalSec);
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 9
// ─────────────────────────────────────────────────────────────

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const records  = parseShiftsFile(textFile);
    const rates    = parseRatesFile(rateFile);
    const monthNum = String(parseInt(String(month), 10)).padStart(2, "0");

    const driverRate = rates.find(r => r.driverID === driverID);
    const dayOff     = driverRate ? driverRate.dayOff : null;

    const NORMAL_QUOTA_SEC = 8 * 3600 + 24 * 60;

    let totalSec = 0;
    for (const r of records) {
        if (r.driverID !== driverID) continue;
        const [, m] = r.date.split("-");
        if (m !== monthNum) continue;
        if (dayOff && getDayOfWeek(r.date) === dayOff) continue;
        if (isEidPeriod(r.date)) continue;
        totalSec += NORMAL_QUOTA_SEC;
    }

    totalSec += bonusCount * 10 * 3600;

    return secondsToHMS(totalSec);
}

// ─────────────────────────────────────────────────────────────
// FUNCTION 10
// ─────────────────────────────────────────────────────────────

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const rates      = parseRatesFile(rateFile);
    const driverRate = rates.find(r => r.driverID === driverID);
    if (!driverRate) return 0;

    const salary = driverRate.salary;
    const tier   = driverRate.tier;

    const actualSec   = durationToSeconds(actualHours);
    const requiredSec = durationToSeconds(requiredHours);

    const graceHours = { 1: 50, 2: 20, 3: 10, 4: 3 };
    const allowedMissingHours = graceHours[tier] || 0;

    const missingSec   = Math.max(0, requiredSec - actualSec);
    const missingHours = Math.floor(missingSec / 3600);

    if (missingHours <= allowedMissingHours) return salary;

    const chargeableHours      = missingHours - allowedMissingHours;
    const deductionRatePerHour = Math.floor(salary / 185);
    const salaryDeduction      = chargeableHours * deductionRatePerHour;
    return salary - salaryDeduction;
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};