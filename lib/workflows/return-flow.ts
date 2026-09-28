import {
    createReturn,
    getOrder,
    notifyReturnInProcess,
    preauthorizeRefund,
} from "@/lib/api";

export async function returnFlow(orderId: string, reason: string) {
    "use workflow";
    return fileReturn(orderId, reason);
}

async function fileReturn(orderId: string, reason: string) {
    "use step";
    const order = await getOrder(orderId);
    await notifyReturnInProcess(orderId);
    await preauthorizeRefund(orderId);
    const filed = await createReturn({
        orderId: order.id,
        items: order.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
        })),
        reason,
    });
    return { orderId, returnId: filed.id };
}