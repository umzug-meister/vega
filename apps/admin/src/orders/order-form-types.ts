import type { CreateOrderInput, OrderAddressInput, OrderDetailsInput } from "@vega/domain";

export type OrderFormValue = Omit<CreateOrderInput, "details" | "to"> & {
  to: OrderAddressInput | undefined;
  details: OrderDetailsInput;
};

export function createEmptyAddress(): OrderAddressInput {
  return {
    street: "",
    postalCode: "",
    city: "",
    floor: "",
    runningDistance: "10 m.",
    parkingSlot: false,
    movementObject: "Wohnung",
    liftType: "kein Aufzug",
    isAltbau: false,
    hasLoft: false,
    hasBasement: false,
    hasGarage: false,
    area: "",
    roomsNumber: "",
    roomsToRelocate: 0,
    packservice: false,
    demontage: false,
    montage: false,
    stockwerke: [],
    kitchenWidth: 0,
    wardrobeWidth: 0,
    bedNumber: 0,
    bulky: false,
  };
}

function localDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createEmptyOrder(): OrderFormValue {
  return {
    customer: { firstName: "", lastName: "", phone: "", salutation: "" },
    from: { ...createEmptyAddress(), demontage: false },
    to: { ...createEmptyAddress(), montage: false },
    movingDate: localDate(),
    movingTime: "07:00",
    orderSource: "individuelle",
    note: "",
    costsAssumption: false,
    details: {
      showSecondaryFrom: false,
      showSecondaryTo: false,
      distanceKm: 0,
      furniture: {
        volume: 0,
        boxes: 0,
        wardrobeBoxes: 0,
        ownItems: "",
        items: [],
        expensive: false,
        expensiveText: "",
        heavy: false,
        heavyText: "",
        bulky: false,
        bulkyText: "",
      },
      extras: { packingRequested: false, services: [] },
      basis: { workers: 0, trucks: 0, hours: 0, basePrice: 0, extraHourPrice: 0, discountPercent: 0 },
      conditions: [],
    },
  };
}
