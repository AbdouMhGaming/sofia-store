ALTER TABLE `inventory`
  ADD CONSTRAINT `inventory_nonnegative` CHECK (`onHand` >= 0 AND `reserved` >= 0 AND `reserved` <= `onHand`);
ALTER TABLE `product_variants`
  ADD CONSTRAINT `variant_valid_prices` CHECK (`priceMinor` > 0 AND `costMinor` >= 0);
