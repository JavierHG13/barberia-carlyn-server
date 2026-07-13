export const appSensor = (req, res, next) => {

    const values = Object.values(req.body || {}).join(" ") + " " + req.url;

    const patterns = [
        { type: "SQL INJECTION", regex: /('|").*(OR|AND).*=.*/i },
        { type: "SQL INJECTION", regex: /\bOR\b\s+\d+=\d+/i },
        { type: "SQL INJECTION", regex: /--/i },

        { type: "XSS", regex: /<script.*?>.*?<\/script>/i },
        { type: "XSS", regex: /onerror=|onload=/i },
        { type: "XSS", regex: /javascript:/i },
        { type: "XSS", regex: /<img|<svg|<iframe/i },

        { type: "COMMAND INJECTION", regex: /(;|\|\||&&)/i }
    ];

    for (let p of patterns) {
        if (p.regex.test(values)) {

            console.log(`
[RASP] Alerta de seguridad detectada
Tipo de ataque: ${p.type}
Payload: ${values}
      `);

            return res.status(403).json({
                message: "Bloqueado por RASP",
                type: p.type
            });
        }
    }

    next();
};