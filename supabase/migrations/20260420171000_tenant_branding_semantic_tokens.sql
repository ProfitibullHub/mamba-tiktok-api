-- M4: semantic branding tokens for full seller-facing customization
-- Adds nullable color tokens for interactive states, finance semantics, chart palette, and toasts.

ALTER TABLE public.tenant_branding
    ADD COLUMN IF NOT EXISTS card_hover_color text,
    ADD COLUMN IF NOT EXISTS interactive_hover_bg text,
    ADD COLUMN IF NOT EXISTS interactive_focus_ring text,
    ADD COLUMN IF NOT EXISTS success_bg text,
    ADD COLUMN IF NOT EXISTS success_text text,
    ADD COLUMN IF NOT EXISTS success_border text,
    ADD COLUMN IF NOT EXISTS warning_bg text,
    ADD COLUMN IF NOT EXISTS warning_text text,
    ADD COLUMN IF NOT EXISTS warning_border text,
    ADD COLUMN IF NOT EXISTS danger_bg text,
    ADD COLUMN IF NOT EXISTS danger_text text,
    ADD COLUMN IF NOT EXISTS danger_border text,
    ADD COLUMN IF NOT EXISTS info_bg text,
    ADD COLUMN IF NOT EXISTS info_text text,
    ADD COLUMN IF NOT EXISTS info_border text,
    ADD COLUMN IF NOT EXISTS profit_color text,
    ADD COLUMN IF NOT EXISTS loss_color text,
    ADD COLUMN IF NOT EXISTS primary_card_bg text,
    ADD COLUMN IF NOT EXISTS primary_card_border text,
    ADD COLUMN IF NOT EXISTS secondary_card_bg text,
    ADD COLUMN IF NOT EXISTS secondary_card_border text,
    ADD COLUMN IF NOT EXISTS toast_success_bg text,
    ADD COLUMN IF NOT EXISTS toast_success_border text,
    ADD COLUMN IF NOT EXISTS toast_success_icon text,
    ADD COLUMN IF NOT EXISTS toast_error_bg text,
    ADD COLUMN IF NOT EXISTS toast_error_border text,
    ADD COLUMN IF NOT EXISTS toast_error_icon text,
    ADD COLUMN IF NOT EXISTS toast_info_bg text,
    ADD COLUMN IF NOT EXISTS toast_info_border text,
    ADD COLUMN IF NOT EXISTS toast_info_icon text,
    ADD COLUMN IF NOT EXISTS toast_warning_bg text,
    ADD COLUMN IF NOT EXISTS toast_warning_border text,
    ADD COLUMN IF NOT EXISTS toast_warning_icon text,
    ADD COLUMN IF NOT EXISTS chart_grid text,
    ADD COLUMN IF NOT EXISTS chart_axis text,
    ADD COLUMN IF NOT EXISTS chart_series_1 text,
    ADD COLUMN IF NOT EXISTS chart_series_2 text,
    ADD COLUMN IF NOT EXISTS chart_series_3 text,
    ADD COLUMN IF NOT EXISTS chart_series_4 text,
    ADD COLUMN IF NOT EXISTS chart_series_5 text,
    ADD COLUMN IF NOT EXISTS chart_series_6 text,
    ADD COLUMN IF NOT EXISTS chart_positive text,
    ADD COLUMN IF NOT EXISTS chart_negative text,
    ADD COLUMN IF NOT EXISTS chart_neutral text;

DO $$
DECLARE
    c text;
    cols text[] := ARRAY[
        'card_hover_color','interactive_hover_bg','interactive_focus_ring',
        'success_bg','success_text','success_border',
        'warning_bg','warning_text','warning_border',
        'danger_bg','danger_text','danger_border',
        'info_bg','info_text','info_border',
        'profit_color','loss_color',
        'primary_card_bg','primary_card_border',
        'secondary_card_bg','secondary_card_border',
        'toast_success_bg','toast_success_border','toast_success_icon',
        'toast_error_bg','toast_error_border','toast_error_icon',
        'toast_info_bg','toast_info_border','toast_info_icon',
        'toast_warning_bg','toast_warning_border','toast_warning_icon',
        'chart_grid','chart_axis',
        'chart_series_1','chart_series_2','chart_series_3',
        'chart_series_4','chart_series_5','chart_series_6',
        'chart_positive','chart_negative','chart_neutral'
    ];
BEGIN
    FOREACH c IN ARRAY cols LOOP
        BEGIN
            EXECUTE format(
                'ALTER TABLE public.tenant_branding ADD CONSTRAINT %I CHECK (%I IS NULL OR %I ~* ''^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$'')',
                'tenant_branding_' || c || '_hex',
                c,
                c
            );
        EXCEPTION
            WHEN duplicate_object THEN
                NULL;
        END;
    END LOOP;
END $$;
