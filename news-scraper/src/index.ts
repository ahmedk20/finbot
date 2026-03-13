import 'dotenv/config';                                                                                                                                                                 
import { env } from './config/env';                                                                                                                                                       
import pino from 'pino';                                                                                                                                                                
                        
const logger = pino({
  transport: {       
    target: 'pino-pretty',
    options: { colorize: true }
  }                                                                                                                                                                                       
});
                                                                                                                                                                                          
logger.info('News scraper starting...');                                                                                                                                                
logger.info(`Environment: ${env.NODE_ENV}`);
logger.info(`Cron schedule: ${env.SCRAPER_CRON_SCHEDULE}`);
logger.info('Ready to scrape');                                                                                                                                                           

                                                                                                                                                                                                                                                                                                                
