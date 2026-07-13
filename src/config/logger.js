import winston from 'winston';
import 'winston-daily-rotate-file';

const dailyRotate = new winston.transports.DailyRotateFile({
  filename: 'logs/app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d'
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    dailyRotate,
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    })
  ]
});

export default logger;
