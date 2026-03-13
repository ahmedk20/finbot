import 'dotenv/config';                
import { env } from './shared/config/env';                                                                                                                                                
import pino from 'pino';                                                                                                                                                                
                                                                                                                                                                                          
const logger = pino({                                                                                                                                                                     
  transport: {       
    target: 'pino-pretty',                                                                                                                                                                
    options: { colorize: true }                                                                                                                                                         
  }                            
});
   
logger.info(`FinBot API starting on port ${env.PORT}`);
logger.info(`Environment: ${env.NODE_ENV}`);                                                                                                                                              
logger.info('Ready');