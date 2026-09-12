export const discountRequirements = [
  {
    id: "D01",
    title: "Discounted receipt and recorded payment agree",
    expected: {
      displayed: "$38.40",
      order: 3840,
      payment: 3840,
      storedPayment: 3840,
      discount: 960,
    },
  },
  {
    id: "D02",
    title: "Discount applies once to eligible quantities; lamp excluded",
    expected: { subtotal: 16100, discount: 1920, order: 14180, payment: 14180 },
  },
  {
    id: "D03",
    title: "Floor whole cents across the combined eligible subtotal",
    expected: { subtotal: 8006, discount: 1601, order: 6405, payment: 6405 },
  },
  {
    id: "D04",
    title: "Checkout without discount charges the correct amount",
    expected: { order: 9600, payment: 9600, discount: 0 },
  },
  {
    id: "D05",
    title: "Invalid code does not reduce the amount",
    expected: { order: 4800, payment: 4800, discount: 0 },
  },
  {
    id: "D06",
    title: "Another buyer cannot access the order",
    expected: { ownerStatus: 200, otherBuyerStatus: 404 },
  },
  {
    id: "D07",
    title: "Buyer-scoped retries create no duplicate charge",
    expected: {
      sameOrder: true,
      samePayment: true,
      orders: 1,
      payments: 1,
      buyerScoped: true,
    },
  },
  {
    id: "D08",
    title: "Server controls prices and payment amounts",
    expected: { order: 4800, payment: 4800, priceEditStatus: 403 },
  },
] as const;
export const knownScenarios = [
  { id: "K01", title: "Paid order missing from history" },
  { id: "K02", title: "Uploaded listing photo does not persist" },
] as const;
