import { z } from 'zod';                     
                                                                                                                                                                                            
const envSchema = z.object({                                                                                                                                                              
  PINECONE_API_KEY:        z.string().min(1, 'PINECONE_API_KEY is required'),                                                                                                             
  PINECONE_INDEX_NAME:     z.string().min(1, 'PINECONE_INDEX_NAME is required'),                                                                                                          
  HUGGINGFACE_API_KEY:     z.string().min(1, 'HUGGINGFACE_API_KEY is required'),                                                                                                          
  SCRAPER_CRON_SCHEDULE:   z.string().default('0 */2 * * *'),                                                                                                                             
  SCRAPER_CONCURRENCY:     z.coerce.number().default(5),                                                                                                                                  
  NODE_ENV:                z.enum(['development', 'production', 'test']).default('development'),                                                                                          
});                                                                                                                                                                                       
                                                                                                                                                                                          
const parsed = envSchema.safeParse(process.env);                                                                                                                                        
                                                                                                                                                                                          
if (!parsed.success) {                                                                                                                                                                  
  console.error('Invalid environment variables:');
  parsed.error.issues.forEach(err => {
    console.error(`  ${err.path.join('.')}: ${err.message}`);
  })                                                                                                                                                                                    
  process.exit(1);                                                                                                                                                                        
}                                                                                                                                                                                         
                                                                                                                                                                                          
export const env = parsed.data;                                                                                                                                                         