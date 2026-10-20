# Contrato futuro de pagos y backops

El validador/backops todavía no está implementado. El núcleo acepta reportes en `pending_review` y debe seguir funcionando con revisión manual mientras el adaptador permanezca desconectado.

## Estados canónicos

| Estado | Significado |
|---|---|
| `pending_review` | Reporte recibido, aún sin evidencia suficiente |
| `verified` | Pago confirmado por un operador autorizado o proveedor |
| `rejected` | Evidencia inválida, con código de motivo |
| `requires_review` | Hay discrepancia o posible duplicado |

Solo admin o la identidad de servicio del backops pueden producir estados terminales. Cada transición registra actor, origen, fecha, estado anterior y motivo en `audit_events`.

## Integración propuesta

La futura ruta `POST /api/integrations/payments/events` debe recibir eventos firmados e idempotentes. No existe todavía y no debe exponerse antes de completar pruebas de firma y repetición.

Cabeceras propuestas:

```text
Content-Type: application/json
X-Uroprofin-Event-Id: identificador único
X-Uroprofin-Timestamp: fecha ISO-8601
X-Uroprofin-Signature: v1=firma-HMAC-del-cuerpo-crudo
```

Cuerpo mínimo propuesto:

```json
{
  "type": "payment.verified",
  "occurredAt": "ISO-8601",
  "payment": {
    "externalId": "",
    "reference": "",
    "amount": 0,
    "currency": "VES",
    "status": "verified",
    "paidAt": "ISO-8601",
    "reasonCode": ""
  },
  "allocations": [
    { "bagAllocationId": "", "amount": 0 }
  ]
}
```

No enviar nombre, teléfono o cédula si el identificador interno y la referencia bastan.

## Reglas del receptor

1. Verificar timestamp y firma sobre el cuerpo crudo antes de interpretar JSON.
2. Rechazar eventos vencidos y almacenar `eventId` para idempotencia.
3. Validar moneda, importe positivo y que la suma de asignaciones coincida.
4. Evitar que una referencia verificada cubra dos veces la misma asignación.
5. Si el importe o referencia difieren, usar `requires_review`; no sobrescribir silenciosamente.
6. Responder 2xx a una repetición ya aplicada, con el mismo resultado.
7. Aplicar la transición y el evento de auditoría en una operación controlada.
8. No registrar el secreto, la firma completa, el comprobante ni el cuerpo íntegro.

## Pagos agrupados, retiros y cortesías

- Un pago puede cubrir varias bolsas/hogares por medio de `payment_allocations`.
- El máximo de 17 aplica a un lote físico retirado por una persona; no limita un pago.
- Un retiro requiere autorización de cada hogar o aprobación administrativa trazable.
- La cortesía se registra como `bag_allocations.allocationType=courtesy`, con motivo y `approvedBy`; no genera un pago ficticio.
- `delivery_self_reports` expresa lo que declara el residente. La entrega oficial pertenece a `delivery_confirmations` y no debe cambiarse automáticamente por ese autorreporte.

## Salida hacia el backops

Si el backops consulta Uroprofin, debe usar una cuenta de servicio de solo el alcance necesario, paginación y filtros por `community`/estado. Si Uroprofin envía eventos, debe aplicar la misma idempotencia, reintentos con espera incremental y cola de errores revisable.
