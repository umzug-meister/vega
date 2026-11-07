-- Older local intake rows stored the technical caller as source. Preserve the
-- intended customer-facing acquisition channel in the order overview instead.
UPDATE `order` SET `source` = 'individuelle' WHERE `source` = 'admin';
UPDATE `order` SET `source` = 'umzugruckzuck.de' WHERE `source` = 'public';
