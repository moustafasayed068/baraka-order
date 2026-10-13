-- Online-paid orders wait in this status until Paymob's webhook confirms payment, so they never reach the kitchen,
-- the TV or riders unpaid. Its own migration: a new enum value can't be used in the transaction that adds it.
alter type order_status add value if not exists 'awaiting_payment' before 'received';
