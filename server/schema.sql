-- 车队中心数据库。在服务器上执行：
--   mysql -u root -p < schema.sql
-- 初始管理员：TMP ID admin，密码 ChangeMe123。登录后请立刻修改。

CREATE DATABASE IF NOT EXISTS fleet_center
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE fleet_center;

CREATE TABLE IF NOT EXISTS center_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number INT NOT NULL DEFAULT 0,
  tmp_id VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL DEFAULT '',
  qq VARCHAR(64) NOT NULL DEFAULT '',
  role VARCHAR(128) NOT NULL DEFAULT '司机',
  score INT NOT NULL DEFAULT 0,
  join_date DATE NULL,
  leave_date DATE NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  is_super TINYINT(1) NOT NULL DEFAULT 0,
  permissions TEXT NULL,
  steam_id VARCHAR(32) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_center_tmp (tmp_id),
  KEY idx_center_number (number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS center_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(64) NOT NULL,
  member_id INT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  host VARCHAR(128) NOT NULL DEFAULT '',
  client_name VARCHAR(128) NOT NULL DEFAULT '车队中心',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_center_token (token),
  KEY idx_center_session_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS center_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL DEFAULT '',
  start_date VARCHAR(32) NOT NULL DEFAULT '',
  end_date VARCHAR(32) NOT NULL DEFAULT '',
  location VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'upcoming',
  content TEXT NULL,
  dlc_ids TEXT NULL,
  checkin_configs MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS center_activity_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_center_activity_file (activity_id, name),
  KEY idx_center_activity_file (activity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS center_checkins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT NOT NULL,
  member_id INT NOT NULL,
  points INT NOT NULL DEFAULT 0,
  note VARCHAR(255) NOT NULL DEFAULT '',
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_center_checkin_activity (activity_id),
  KEY idx_center_checkin_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS center_point_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_id INT NOT NULL,
  delta INT NOT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_center_point_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS center_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL DEFAULT '',
  price INT NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'on',
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS center_redeems (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  member_id INT NOT NULL,
  product_name VARCHAR(128) NOT NULL DEFAULT '',
  price INT NOT NULL DEFAULT 0,
  qq VARCHAR(64) NOT NULL DEFAULT '',
  note VARCHAR(255) NOT NULL DEFAULT '',
  ship_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_center_redeem_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS center_dlcs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name_zh VARCHAR(128) NOT NULL DEFAULT '',
  name_en VARCHAR(128) NOT NULL DEFAULT '',
  kind TINYINT NOT NULL DEFAULT 1,
  price INT NOT NULL DEFAULT 0,
  steam_app_id VARCHAR(32) NOT NULL DEFAULT '',
  cover_url VARCHAR(500) NOT NULL DEFAULT '',
  scs_files TEXT NULL,
  UNIQUE KEY uk_center_dlc_steam (steam_app_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO center_members
  (number, tmp_id, name, password_hash, role, is_admin, is_super)
SELECT 0, 'admin', '超级管理员',
  'scrypt$75d2f1c92db7770803784b14f3c7668e$beeb3ccf7a1b184eefdf144c223b9c5c8126e71d170a2edf47edbd94631342f7',
  '超级管理员', 1, 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM center_members WHERE tmp_id = 'admin');

INSERT IGNORE INTO center_dlcs (name_zh, name_en, kind, steam_app_id, scs_files) VALUES
  ('希腊', 'Greece', 1, '2604420', '["dlc_greece.scs"]'),
  ('西巴尔干', 'West Balkans', 1, '2004210', '["dlc_balkan_w.scs"]'),
  ('伊比利亚', 'Iberia', 1, '1209460', '["dlc_iberia.scs"]'),
  ('通往黑海之路', 'Road to the Black Sea', 1, '1056760', '["dlc_balkan_e.scs"]'),
  ('波罗的海彼岸', 'Beyond the Baltic Sea', 1, '925580', '["dlc_balt.scs"]'),
  ('意大利', 'Italia', 1, '558244', '["dlc_it.scs"]'),
  ('法兰西万岁！', 'Vive la France!', 1, '531130', '["dlc_fr.scs"]'),
  ('斯堪的纳维亚', 'Scandinavia', 1, '304212', '["dlc_north.scs"]'),
  ('向东前进！', 'Going East!', 1, '227310', '["dlc_east.scs"]'),
  ('极地', 'Polar', 1, '910001', '["dlc_polar.scs"]'),
  ('冰岛', 'Iceland', 1, '3796990', '["dlc_iceland.scs"]'),
  ('客运', 'Coaches', 3, '3809270', '["dlc_bus.scs"]'),
  ('Schwarzmüller 挂车包', 'Schwarzmuller', 2, '388477', '["dlc_schwarzmuller.scs"]'),
  ('Feldbinder 挂车包', 'Feldbinder', 2, '2193220', '["dlc_feldbinder.scs"]'),
  ('Wielton 挂车包', 'Wielton', 2, '2455690', '["dlc_wielton.scs"]'),
  ('TIRSAN 挂车包', 'TIRSAN', 2, '2569750', '["dlc_tirsan.scs"]'),
  ('Schmitz Cargobull 挂车包', 'Schmitz', 2, '2833100', '["dlc_schmitz.scs"]'),
  ('Kögel 挂车包', 'Kogel', 2, '3034940', '["dlc_kogel.scs"]'),
  ('Kässbohrer 挂车包', 'Kassbohrer', 2, '3034950', '["dlc_kassbohrer.scs"]'),
  ('Krone 挂车包', 'Krone', 2, '933610', '["dlc_krone.scs"]'),
  ('Krone 农业挂车', 'Krone Agriculture', 2, '910002', '["dlc_krone_agriculture.scs"]');
