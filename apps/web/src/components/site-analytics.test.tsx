import { render } from "@testing-library/react";

import { redactAnalyticsEvent } from "../lib/analytics-redaction";
import {
  renderedAnalyticsProps,
  resetRenderedAnalyticsProps,
} from "../test-support/analytics-mock";
import { SiteAnalytics } from "./site-analytics";

describe("the site's analytics island", () => {
  beforeEach(() => {
    resetRenderedAnalyticsProps();
  });

  it("hands Vercel Web Analytics the redaction, so no reset token is recorded (PR #238)", () => {
    render(<SiteAnalytics />);

    const rendered = renderedAnalyticsProps();
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.beforeSend).toBe(redactAnalyticsEvent);
  });
});
