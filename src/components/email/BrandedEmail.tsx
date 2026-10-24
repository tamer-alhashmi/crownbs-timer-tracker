import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

type EmailMetric = { label: string; value: string };

type BrandedEmailProps = {
  preview: string;
  title: string;
  greeting: string;
  description: string;
  metrics?: EmailMetric[];
  verificationCode?: string;
};

export function BrandedEmail({
  preview,
  title,
  greeting,
  description,
  metrics = [],
  verificationCode,
}: BrandedEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, backgroundColor: "#f1f5f9", fontFamily: "Arial, sans-serif" }}>
        <Container style={{ maxWidth: "600px", margin: "32px auto", padding: "28px", backgroundColor: "#ffffff", borderRadius: "16px" }}>
          <Text style={{ margin: "0 0 8px", color: "#0369a1", fontSize: "12px", fontWeight: 700, letterSpacing: "2px" }}>
            CROWNBS OPERATIONS
          </Text>
          <Heading style={{ margin: "0 0 12px", color: "#0f172a", fontSize: "24px" }}>{title}</Heading>
          <Text style={{ color: "#334155", fontSize: "15px", lineHeight: "24px" }}>{greeting}</Text>
          <Text style={{ color: "#475569", fontSize: "14px", lineHeight: "22px" }}>{description}</Text>
          {verificationCode && (
            <Section style={{ margin: "24px 0", padding: "18px", backgroundColor: "#f0f9ff", borderRadius: "12px", textAlign: "center" }}>
              <Text style={{ margin: "0 0 8px", color: "#475569", fontSize: "12px" }}>Your six-digit verification code</Text>
              <Text style={{ margin: 0, color: "#0c4a6e", fontSize: "32px", fontWeight: 700, letterSpacing: "8px" }}>{verificationCode}</Text>
            </Section>
          )}
          {metrics.length > 0 && (
            <Section style={{ margin: "24px 0" }}>
              {metrics.map((metric) => (
                <Section key={metric.label} style={{ padding: "12px 0", borderBottom: "1px solid #e2e8f0" }}>
                  <Text style={{ display: "inline-block", width: "60%", margin: 0, color: "#475569", fontSize: "14px" }}>{metric.label}</Text>
                  <Text style={{ display: "inline-block", width: "40%", margin: 0, color: "#0f172a", fontSize: "14px", fontWeight: 700, textAlign: "right" }}>{metric.value}</Text>
                </Section>
              ))}
            </Section>
          )}
          {verificationCode && <Text style={{ color: "#64748b", fontSize: "12px" }}>This code expires in 10 minutes. If you did not request it, you can ignore this email.</Text>}
          <Hr style={{ margin: "28px 0 16px", borderColor: "#e2e8f0" }} />
          <Text style={{ margin: 0, color: "#94a3b8", fontSize: "11px" }}>CrownBS Operations · Automated account communication</Text>
        </Container>
      </Body>
    </Html>
  );
}
