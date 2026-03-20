-- Add timezone column to tiktok_shops table
-- This stores the IANA timezone identifier based on the shop's region

ALTER TABLE tiktok_shops 
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/Los_Angeles';

-- Add comment explaining the column
COMMENT ON COLUMN tiktok_shops.timezone IS 'IANA timezone identifier for shop (e.g., America/New_York, Europe/London, Asia/Singapore). Used for all date calculations and filtering.';

-- Create index for timezone lookups
CREATE INDEX IF NOT EXISTS idx_tiktok_shops_timezone ON tiktok_shops(timezone);

-- Update existing shops to have correct timezone based on their region
UPDATE tiktok_shops 
SET timezone = CASE 
  -- United Kingdom & Europe
  WHEN region = 'GB' OR region = 'UK' THEN 'Europe/London'
  WHEN region = 'DE' THEN 'Europe/Berlin'
  WHEN region = 'FR' THEN 'Europe/Paris'
  WHEN region = 'IT' THEN 'Europe/Rome'
  WHEN region = 'ES' THEN 'Europe/Madrid'
  
  -- Asia Pacific
  WHEN region = 'SG' THEN 'Asia/Singapore'
  WHEN region = 'MY' THEN 'Asia/Kuala_Lumpur'
  WHEN region = 'TH' THEN 'Asia/Bangkok'
  WHEN region = 'VN' THEN 'Asia/Ho_Chi_Minh'
  WHEN region = 'PH' THEN 'Asia/Manila'
  WHEN region = 'ID' THEN 'Asia/Jakarta'
  WHEN region = 'CN' THEN 'Asia/Shanghai'
  WHEN region = 'HK' THEN 'Asia/Hong_Kong'
  WHEN region = 'JP' THEN 'Asia/Tokyo'
  WHEN region = 'KR' THEN 'Asia/Seoul'
  WHEN region = 'IN' THEN 'Asia/Kolkata'
  WHEN region = 'AU' THEN 'Australia/Sydney'
  WHEN region = 'NZ' THEN 'Pacific/Auckland'
  
  -- Americas
  WHEN region = 'US' THEN 'America/Los_Angeles'
  WHEN region = 'CA' THEN 'America/Toronto'
  WHEN region = 'MX' THEN 'America/Mexico_City'
  WHEN region = 'BR' THEN 'America/Sao_Paulo'
  WHEN region = 'AR' THEN 'America/Argentina/Buenos_Aires'
  WHEN region = 'CL' THEN 'America/Santiago'
  WHEN region = 'CO' THEN 'America/Bogota'
  WHEN region = 'PE' THEN 'America/Lima'
  WHEN region = 'VE' THEN 'America/Caracas'
  WHEN region = 'EC' THEN 'America/Guayaquil'
  WHEN region = 'UY' THEN 'America/Montevideo'
  WHEN region = 'PY' THEN 'America/Asuncion'
  WHEN region = 'BO' THEN 'America/La_Paz'
  WHEN region = 'CR' THEN 'America/Costa_Rica'
  WHEN region = 'PA' THEN 'America/Panama'
  WHEN region = 'GT' THEN 'America/Guatemala'
  WHEN region = 'HN' THEN 'America/Tegucigalpa'
  WHEN region = 'SV' THEN 'America/El_Salvador'
  WHEN region = 'NI' THEN 'America/Managua'
  WHEN region = 'DO' THEN 'America/Santo_Domingo'
  WHEN region = 'PR' THEN 'America/Puerto_Rico'
  WHEN region = 'JM' THEN 'America/Jamaica'
  WHEN region = 'TT' THEN 'America/Port_of_Spain'
  
  -- Middle East & Africa
  WHEN region = 'AE' THEN 'Asia/Dubai'
  WHEN region = 'SA' THEN 'Asia/Riyadh'
  WHEN region = 'ZA' THEN 'Africa/Johannesburg'
  WHEN region = 'EG' THEN 'Africa/Cairo'
  WHEN region = 'NG' THEN 'Africa/Lagos'
  
  -- Default to Pacific Time for US and unknown regions
  ELSE 'America/Los_Angeles'
END
WHERE timezone IS NULL OR timezone = 'America/Los_Angeles';

-- Verify the update
SELECT region, timezone, COUNT(*) as shop_count
FROM tiktok_shops
GROUP BY region, timezone
ORDER BY region;
